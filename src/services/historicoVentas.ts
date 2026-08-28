import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { log, warn } from '../utils/logger';
import { getInvoicingV1Client } from './holdedClient';

// Histórico de lo entregado, sacado de los albaranes de Holded.
//
// Ojo con las expectativas: en Holded NO hay años anteriores. El albarán más
// antiguo es del 31/01/2026 y los tickets empiezan el 31/12/2025, así que
// comparar con "el mismo mes del año pasado" no es posible todavía. Lo que sí
// da esta base es el patrón por DÍA DE LA SEMANA de cada cliente, que en una
// panadería es lo que de verdad manda.
//
// Se cachea en disco porque son ~3.800 documentos: bajarlos enteros en cada
// consulta tarda demasiado para un comando de Telegram.

export interface EntregaLinea { sku: string; name: string; units: number; }
export interface Entrega {
  fecha: string;            // AAAA-MM-DD
  contactId: string;
  cliente: string;
  lineas: EntregaLinea[];
}

interface Cache { entregas: Entrega[]; actualizado: string; version?: number }

// Se sube cuando cambia lo que se guarda, para que la caché vieja se tire sola.
// v2: se dejan de filtrar las líneas negativas (son las devoluciones).
const VERSION = 2;

const RUTA = process.env['HISTORICO_PATH'] ?? config.historicoPath;
const PAGINAS_MAX = 40;

let memoria: Cache | null = null;

function leerDisco(): Cache | null {
  try {
    if (fs.existsSync(RUTA)) return JSON.parse(fs.readFileSync(RUTA, 'utf-8')) as Cache;
  } catch (err) {
    warn('Historico', `No se pudo leer ${RUTA}: ${(err as Error).message}`);
  }
  return null;
}

function escribirDisco(c: Cache): void {
  fs.mkdirSync(path.dirname(RUTA), { recursive: true });
  fs.writeFileSync(RUTA, JSON.stringify(c), 'utf-8');
}

function mapear(doc: any): Entrega {
  return {
    fecha: new Date(doc.date * 1000).toISOString().slice(0, 10),
    contactId: typeof doc.contact === 'string' ? doc.contact : (doc.contact?.$oid ?? ''),
    cliente: doc.contactName ?? '',
    // Las líneas NEGATIVAS son devoluciones: lo que sobró y volvió. Antes se
    // descartaban y el histórico daba lo entregado en bruto, no lo vendido.
    lineas: (doc.products ?? [])
      .filter((l: any) => Number(l.units) !== 0)
      .map((l: any) => ({ sku: l.sku ?? '', name: l.name ?? '', units: Number(l.units) })),
  };
}

// Descarga todos los albaranes. Holded pagina de 500 en 500 y no admite filtro
// por fechas en este endpoint (probado: starttmp/endtmp se ignoran), así que
// se recorre hasta que una página viene vacía.
export async function descargarTodo(): Promise<Entrega[]> {
  const cliente = getInvoicingV1Client();
  const entregas: Entrega[] = [];
  for (let p = 1; p <= PAGINAS_MAX; p++) {
    const r = await cliente.get<any[]>(`/documents/waybill?page=${p}`);
    const datos = r.data ?? [];
    if (!datos.length) break;
    entregas.push(...datos.map(mapear));
  }
  log('Historico', `Descargados ${entregas.length} albaranes`);
  return entregas;
}

export async function cargar(refrescar = false): Promise<Entrega[]> {
  if (!refrescar) {
    memoria ??= leerDisco();
    // Una caché de una versión anterior se vuelve a bajar: la de v1 no tiene
    // las devoluciones y daría cifras infladas sin avisar.
    if (memoria?.entregas.length && memoria.version === VERSION) return memoria.entregas;
  }
  const entregas = await descargarTodo();
  memoria = { entregas, actualizado: new Date().toISOString(), version: VERSION };
  escribirDisco(memoria);
  return entregas;
}

export function actualizadoEn(): string | undefined {
  memoria ??= leerDisco();
  return memoria?.actualizado;
}

// ── Análisis ──────────────────────────────────────────────────────────────────

export function clientes(entregas: Entrega[]): Array<{ contactId: string; cliente: string; entregas: number }> {
  const m = new Map<string, { contactId: string; cliente: string; entregas: number }>();
  for (const e of entregas) {
    const v = m.get(e.cliente) ?? { contactId: e.contactId, cliente: e.cliente, entregas: 0 };
    v.entregas += 1;
    m.set(e.cliente, v);
  }
  return [...m.values()].sort((a, b) => b.entregas - a.entregas);
}

export function diaSemana(fecha: string): number {
  return new Date(`${fecha}T12:00:00Z`).getUTCDay();   // 0 domingo
}

export interface MediaProducto {
  producto: string;
  sku: string;
  dias: number;          // días en que se le entregó algo de esto
  total: number;
  media: number;         // media por día de entrega
}

// Positivas de una entrega (lo servido) y negativas (lo devuelto).
export function servido(e: Entrega): EntregaLinea[] {
  return e.lineas.filter(l => l.units > 0);
}
export function devuelto(e: Entrega): EntregaLinea[] {
  return e.lineas.filter(l => l.units < 0).map(l => ({ ...l, units: -l.units }));
}

// Media por producto de un cliente en un día de la semana concreto.
// Se divide entre los días en que hubo entrega, no entre todos los días: si a
// un cliente solo se le sirve los sábados, dividir entre 7 daría una media
// falsa de casi cero.
export function mediaPorDia(
  entregas: Entrega[], cliente: string, dow: number, desde?: string
): MediaProducto[] {
  const suyas = entregas.filter(e =>
    e.cliente === cliente && diaSemana(e.fecha) === dow && (!desde || e.fecha >= desde));

  const m = new Map<string, { producto: string; sku: string; total: number; dias: Set<string> }>();
  for (const e of suyas) {
    // Solo lo servido: mezclar aquí las devoluciones daría una media que no es
    // ni lo entregado ni lo vendido.
    for (const l of servido(e)) {
      const k = l.sku || l.name;
      const v = m.get(k) ?? { producto: l.name, sku: l.sku, total: 0, dias: new Set<string>() };
      v.total += l.units;
      v.dias.add(e.fecha);
      m.set(k, v);
    }
  }
  return [...m.values()]
    .map(v => ({
      producto: v.producto, sku: v.sku, dias: v.dias.size, total: v.total,
      media: v.dias.size ? v.total / v.dias.size : 0,
    }))
    .sort((a, b) => b.media - a.media);
}
