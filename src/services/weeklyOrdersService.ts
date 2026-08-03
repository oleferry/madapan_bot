import * as sheetsClient from './sheetsClient';
import * as holdedClient from './holdedClient';
import { log, warn } from '../utils/logger';

// Columnas de la pestaña "Holded modelo" (A..S)
const COL = { NUM: 0, FECHA: 2, CONTACTO: 5, NIF: 6, CONCEPTO: 12, SKU: 14, PRECIO: 15, UNIDADES: 16, DTO: 17, IVA: 18 };

// Rango de pedidos que consideramos normal para una semana. Si el resultado se
// sale de aquí es que algo ha ido mal en la hoja, y preferimos abortar antes
// que crear documentos a lo loco en Holded.
const MIN_PEDIDOS = 60;
const MAX_PEDIDOS = 250;

export interface OrderLine {
  sku: string;
  name: string;
  units: number;
  price: number;
  discount: number;
  taxPct: number;
}

export interface WeeklyOrder {
  numPedido: string;   // P-20260810-B70954391
  fecha: string;       // YYYY-MM-DD
  nif: string;
  contacto: string;
  lines: OrderLine[];
}

// "1.234,56" -> 1234.56  |  "1,88" -> 1.88
function num(v: string | undefined): number {
  if (!v) return 0;
  const n = parseFloat(String(v).trim().replace(/\./g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

// "10/08/2026" -> "2026-08-10"
function fechaIso(v: string | undefined): string {
  if (!v) return '';
  const t = v.trim();
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  return '';
}

export interface ReadResult {
  orders: WeeklyOrder[];
  problemas: string[];
}

// Lee "Holded modelo" y agrupa las líneas en pedidos. Devuelve también los
// problemas detectados, para poder abortar antes de tocar Holded.
export async function readWeeklyOrders(): Promise<ReadResult> {
  const rows = await sheetsClient.readRange('Holded modelo!A2:S1000');
  const problemas: string[] = [];
  const porNum = new Map<string, WeeklyOrder>();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const numPedido = (r[COL.NUM] ?? '').trim();
    if (!numPedido) continue; // fila vacía: la hoja deja huecos al final

    const fila = i + 2;
    const nif = (r[COL.NIF] ?? '').trim();
    const sku = (r[COL.SKU] ?? '').trim();
    const fecha = fechaIso(r[COL.FECHA]);
    const units = num(r[COL.UNIDADES]);
    const price = num(r[COL.PRECIO]);

    // Cualquier "REVISAR" que haya dejado la hoja invalida la carga entera
    const textoFila = r.join(' ');
    if (textoFila.includes('REVISAR')) {
      problemas.push(`Fila ${fila} (${numPedido}): contiene REVISAR`);
      continue;
    }
    if (!nif) { problemas.push(`Fila ${fila} (${numPedido}): sin NIF`); continue; }
    if (!sku) { problemas.push(`Fila ${fila} (${numPedido}): sin SKU`); continue; }
    if (!fecha) { problemas.push(`Fila ${fila} (${numPedido}): fecha ilegible "${r[COL.FECHA]}"`); continue; }
    if (units <= 0) continue;  // 0 unidades: se omite, es normal
    if (price <= 0) { problemas.push(`Fila ${fila} (${numPedido}): precio 0`); continue; }

    let pedido = porNum.get(numPedido);
    if (!pedido) {
      pedido = { numPedido, fecha, nif, contacto: (r[COL.CONTACTO] ?? '').trim(), lines: [] };
      porNum.set(numPedido, pedido);
    }
    pedido.lines.push({
      sku,
      name: (r[COL.CONCEPTO] ?? '').trim(),
      units,
      price,
      discount: num(r[COL.DTO]),
      taxPct: num(r[COL.IVA]),
    });
  }

  const orders = [...porNum.values()].filter(o => o.lines.length > 0);

  if (orders.length < MIN_PEDIDOS || orders.length > MAX_PEDIDOS) {
    problemas.push(
      `Número de pedidos fuera de lo normal: ${orders.length} (se esperaban entre ${MIN_PEDIDOS} y ${MAX_PEDIDOS})`
    );
  }

  log('WeeklyOrders', `Leídos ${orders.length} pedidos, ${problemas.length} problemas`);
  return { orders, problemas };
}

// Fija en la hoja el lunes de la semana que toca cargar.
export async function setWeekMonday(fechaIsoStr: string): Promise<void> {
  const [y, m, d] = fechaIsoStr.split('-');
  await sheetsClient.writeCell('Config!B2', `${d}/${m}/${y}`);
}

// Lunes siguiente al día de hoy (si hoy es lunes, el de dentro de 7 días).
export function nextMonday(from: Date): string {
  const d = new Date(from);
  const dow = d.getDay();
  const diff = ((8 - dow) % 7) || 7;
  d.setDate(d.getDate() + diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface CreateResult {
  creados: number;
  omitidos: number;
  fallidos: Array<{ numPedido: string; motivo: string }>;
}

// Crea en Holded los pedidos que aún no existen. La idempotencia va por
// contacto+fecha: si ya hay un pedido de ese cliente ese día, se omite. Sin
// esto, ejecutar dos veces duplicaría toda la semana.
export async function createOrdersInHolded(orders: WeeklyOrder[]): Promise<CreateResult> {
  const res: CreateResult = { creados: 0, omitidos: 0, fallidos: [] };

  // Qué hay ya en Holded, por fecha
  const fechas = [...new Set(orders.map(o => o.fecha))];
  const existentes = new Set<string>();
  for (const f of fechas) {
    for (const o of await holdedClient.listAllOrdersForDate(f)) {
      existentes.add(`${o.contactId}|${f}`);
    }
  }

  // NIF -> contactId (una sola vez por cliente)
  const contactos = new Map<string, string | null>();
  for (const nif of new Set(orders.map(o => o.nif))) {
    const c = await holdedClient.findContactByNif(nif);
    contactos.set(nif, c?.id ?? null);
  }

  for (const o of orders) {
    const contactId = contactos.get(o.nif) ?? null;
    if (!contactId) {
      res.fallidos.push({ numPedido: o.numPedido, motivo: `NIF ${o.nif} no existe en Holded` });
      continue;
    }
    if (existentes.has(`${contactId}|${o.fecha}`)) {
      res.omitidos++;
      continue;
    }
    const r = await holdedClient.createSalesOrder(contactId, o.fecha, o.lines);
    if (r.ok) {
      res.creados++;
      existentes.add(`${contactId}|${o.fecha}`); // por si la hoja repite el pedido
    } else {
      res.fallidos.push({ numPedido: o.numPedido, motivo: r.error ?? 'error desconocido' });
    }
  }

  if (res.fallidos.length) warn('WeeklyOrders', `${res.fallidos.length} pedidos fallidos`);
  log('WeeklyOrders', `Creados ${res.creados}, omitidos ${res.omitidos}, fallidos ${res.fallidos.length}`);
  return res;
}
