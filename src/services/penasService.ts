import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { log, warn } from '../utils/logger';

// Pedidos de peñas para las fiestas.
//
// A diferencia de los encargos, esto lo rellena la propia peña desde Telegram:
// el enlace se comparte por redes y entra directo al flujo. Por eso el nombre
// de la peña y el teléfono son obligatorios y todo lo demás va con botones.

export const DIAS_FIESTAS = [
  { fecha: '2026-09-19', etiqueta: 'sábado 19 de septiembre' },
  { fecha: '2026-09-26', etiqueta: 'sábado 26 de septiembre' },
  { fecha: '2026-09-28', etiqueta: 'lunes 28 de septiembre' },
  { fecha: '2026-09-29', etiqueta: 'martes 29 de septiembre' },
  { fecha: '2026-09-30', etiqueta: 'miércoles 30 de septiembre' },
];

// Los regalos van por IMPORTE del pedido de todas las fiestas, no por número
// de días: una peña que pide mucho un solo día merece lo mismo que otra que
// reparte poco en cinco.
//
// Se entregan el último día. La Super cookie salió del regalo el 31/08/2026:
// es un producto de venta (COOK-SUP, 7,50 €) y se pide como cualquier otro.
export const DIA_REGALO = '2026-09-30';

export const UMBRALES = [
  { desde: 120, regalos: ['Super chapata', 'Brazo gitano'] },
  { desde: 60, regalos: ['Super chapata'] },
];

// Qué le toca a un pedido de ese importe. "Superar" es estrictamente mayor:
// 60 € clavados no llegan, 60,01 sí.
export function regalosPara(total: number): string[] {
  return UMBRALES.find(u => total > u.desde)?.regalos ?? [];
}

// Cuánto falta para el siguiente regalo, si es que falta algo.
export function siguienteUmbral(total: number): { desde: number; regalos: string[] } | null {
  const pendientes = [...UMBRALES].sort((a, b) => a.desde - b.desde).filter(u => total <= u.desde);
  return pendientes[0] ?? null;
}

export interface LineaPena {
  producto: string;
  cantidad: number;
  regalo?: boolean;
}

export interface PedidoDia {
  fecha: string;
  lineas: LineaPena[];
}

export interface PedidoPena {
  numero: string;              // PÑ-0001
  pena: string;
  telefono: string;
  telegramId: string;
  dias: PedidoDia[];
  total: number;               // PVP de todo el pedido, IVA incluido
  regalos: string[];
  sinPrecio: string[];         // productos que no se pudieron valorar
  creadoEn: string;
  cancelado?: boolean;
}

const RUTA = process.env['PENAS_PATH'] ?? config.penasPath;

let cache: PedidoPena[] | null = null;

function cargar(): PedidoPena[] {
  if (cache) return cache;
  try {
    if (fs.existsSync(RUTA)) {
      cache = JSON.parse(fs.readFileSync(RUTA, 'utf-8')) as PedidoPena[];
      log('Penas', `Cargados ${cache.length} pedidos de peñas`);
      return cache;
    }
  } catch (err) {
    warn('Penas', `No se pudo leer ${RUTA}: ${(err as Error).message}`);
  }
  cache = [];
  return cache;
}

function guardar(): void {
  const p = cargar();
  fs.mkdirSync(path.dirname(RUTA), { recursive: true });
  fs.writeFileSync(RUTA, JSON.stringify(p, null, 2), 'utf-8');
}

// Importe del pedido. Los regalos no suman: si sumaran, un regalo podría
// empujar el total por encima del siguiente umbral y desbloquear otro.
export function calcularTotal(
  dias: PedidoDia[], precios: Map<string, number>
): { total: number; sinPrecio: string[] } {
  let total = 0;
  const sinPrecio = new Set<string>();
  for (const d of dias) {
    for (const l of d.lineas) {
      if (l.regalo) continue;
      const p = precios.get(normalizarNombre(l.producto));
      if (p === undefined) { sinPrecio.add(l.producto); continue; }
      total += p * l.cantidad;
    }
  }
  return { total: Math.round(total * 100) / 100, sinPrecio: [...sinPrecio] };
}

function normalizarNombre(s: string): string {
  return (s ?? '').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function crear(datos: {
  pena: string; telefono: string; telegramId: string; dias: PedidoDia[];
  precios: Map<string, number>;
}): PedidoPena {
  const lista = cargar();
  const { total, sinPrecio } = calcularTotal(datos.dias, datos.precios);
  const regalos = regalosPara(total);

  // Los regalos se añaden como líneas del último día, para que aparezcan en
  // producción y nadie se olvide de prepararlos.
  const dias = datos.dias.map(d => ({ ...d, lineas: [...d.lineas] }));
  if (regalos.length) {
    let ultimo = dias.find(d => d.fecha === DIA_REGALO);
    if (!ultimo) {
      ultimo = { fecha: DIA_REGALO, lineas: [] };
      dias.push(ultimo);
    }
    for (const r of regalos) {
      if (!ultimo.lineas.some(l => l.producto === r)) {
        ultimo.lineas.push({ producto: r, cantidad: 1, regalo: true });
      }
    }
  }

  const pedido: PedidoPena = {
    numero: `PÑ-${String(lista.length + 1).padStart(4, '0')}`,
    pena: datos.pena,
    telefono: datos.telefono,
    telegramId: datos.telegramId,
    dias: dias.sort((a, b) => a.fecha.localeCompare(b.fecha)),
    total, regalos, sinPrecio,
    creadoEn: new Date().toISOString(),
  };
  lista.push(pedido);
  guardar();
  log('Penas', `${pedido.numero}: ${pedido.pena}, ${total.toFixed(2)} €` +
    (regalos.length ? ` (regalo: ${regalos.join(' + ')})` : ''));
  return pedido;
}

export function todos(): PedidoPena[] {
  return cargar().filter(p => !p.cancelado);
}

export function dePena(telegramId: string): PedidoPena[] {
  return todos().filter(p => p.telegramId === telegramId);
}

export function buscar(numero: string): PedidoPena | undefined {
  return cargar().find(p => p.numero === numero);
}

export function cancelar(numero: string): PedidoPena | null {
  const p = buscar(numero);
  if (!p || p.cancelado) return null;
  p.cancelado = true;
  guardar();
  log('Penas', `${numero} cancelado`);
  return p;
}

// Totales de un día, para el obrador.
export function totalesDia(fecha: string): Array<{ producto: string; cantidad: number }> {
  const m = new Map<string, number>();
  for (const p of todos()) {
    for (const d of p.dias.filter(d => d.fecha === fecha)) {
      for (const l of d.lineas) {
        m.set(l.producto, (m.get(l.producto) ?? 0) + l.cantidad);
      }
    }
  }
  return [...m.entries()]
    .map(([producto, cantidad]) => ({ producto, cantidad }))
    .sort((a, b) => b.cantidad - a.cantidad);
}

export function textoPedido(p: PedidoPena): string {
  let t = `🎪 ${p.numero} — ${p.pena}\n📞 ${p.telefono}\n\n`;
  for (const d of p.dias) {
    const et = DIAS_FIESTAS.find(f => f.fecha === d.fecha)?.etiqueta ?? d.fecha;
    t += `${et}\n`;
    for (const l of d.lineas) {
      t += `   ${l.cantidad} × ${l.producto}${l.regalo ? '  🎁 regalo' : ''}\n`;
    }
  }
  t += `\nTotal: ${p.total.toFixed(2)} €`;
  if (p.sinPrecio.length) t += `  (sin valorar: ${p.sinPrecio.join(', ')})`;
  if (p.regalos.length) t += `\n🎁 Regalo: ${p.regalos.join(' + ')} el día 30.`;
  return t;
}

// Resumen para el staff: qué hay que producir cada día de fiestas.
export function resumen(): string {
  const pedidos = todos();
  if (!pedidos.length) return 'Todavía no hay ningún pedido de peñas.';

  let t = `🎪 PEDIDOS DE PEÑAS — ${pedidos.length} peña(s)\n`;
  t += `${pedidos.filter(p => p.regalos.length).length} con regalo · ` +
    `${pedidos.reduce((x, p) => x + p.total, 0).toFixed(2)} € en total\n\n`;
  for (const f of DIAS_FIESTAS) {
    const totales = totalesDia(f.fecha);
    t += `— ${f.etiqueta} —\n`;
    if (!totales.length) { t += '   nada\n\n'; continue; }
    for (const x of totales) t += `   ${x.cantidad} × ${x.producto}\n`;
    t += '\n';
  }
  t += 'Peñas: ' + pedidos.map(p => p.pena).join(', ');
  return t;
}

// Bloque para el resumen de producción del día.
//
// Va aparte de los encargos porque es otra cosa: un encargo se recoge suelto,
// esto es el pedido de una peña entera. Al obrador le importa saber para quién
// es, que son cantidades grandes y se entregan juntas.
export function textoProduccion(fecha: string): string {
  const totales = totalesDia(fecha);
  if (!totales.length) return '';

  const delDia = todos().filter(p => p.dias.some(d => d.fecha === fecha && d.lineas.length));
  let txt = `
🎪 *PEÑAS* (${delDia.length})
`;
  for (const t of totales) txt += `  ${t.cantidad} × ${t.producto}
`;

  // Quién se lleva qué: son pedidos que se preparan y se entregan enteros.
  for (const p of delDia) {
    const suyo = p.dias.find(d => d.fecha === fecha)!;
    txt += `    · ${p.pena} (${p.telefono}): `;
    txt += suyo.lineas.map(l => `${l.cantidad} ${l.producto}${l.regalo ? ' 🎁' : ''}`).join(', ');
    txt += '\n';
  }
  return txt;
}

// Solo para tests.
export function _reset(): void { cache = null; }
