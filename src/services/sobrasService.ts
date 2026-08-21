import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { log, warn } from '../utils/logger';
import * as historico from './historicoVentas';

// Sobras por punto de entrega. Hoy se cuentan por WhatsApp y se pierden: nadie
// puede sumarlas al cabo de un mes.
//
// La cuenta que interesa es simple: lo entregado (albarán de Holded) menos lo
// que sobró = lo que de verdad se vendió. Con eso, la producción sugerida deja
// de ser una corazonada.

export interface SobraLinea { producto: string; sku?: string; cantidad: number; }

export interface Sobra {
  id: string;
  fecha: string;              // día al que corresponden las sobras
  cliente: string;            // nombre del punto, como en Holded
  lineas: SobraLinea[];
  registradoPor: string;
  creadoEn: string;
}

interface Almacen { sobras: Sobra[]; }

const RUTA = process.env['SOBRAS_PATH'] ?? config.sobrasPath;

let cache: Almacen | null = null;

function cargar(): Almacen {
  if (cache) return cache;
  try {
    if (fs.existsSync(RUTA)) {
      cache = JSON.parse(fs.readFileSync(RUTA, 'utf-8')) as Almacen;
      log('Sobras', `Cargadas ${cache.sobras.length} anotaciones`);
      return cache;
    }
  } catch (err) {
    warn('Sobras', `No se pudo leer ${RUTA}: ${(err as Error).message}`);
  }
  cache = { sobras: [] };
  return cache;
}

function guardar(): void {
  const a = cargar();
  fs.mkdirSync(path.dirname(RUTA), { recursive: true });
  fs.writeFileSync(RUTA, JSON.stringify(a, null, 2), 'utf-8');
}

export function registrar(datos: {
  fecha: string; cliente: string; lineas: SobraLinea[]; registradoPor: string;
}): Sobra {
  const a = cargar();
  // Volver a anotar el mismo punto y día REEMPLAZA lo anterior: si alguien
  // recuenta, lo que vale es la última cuenta, no la suma de las dos.
  const previa = a.sobras.findIndex(s => s.fecha === datos.fecha && s.cliente === datos.cliente);
  const sobra: Sobra = {
    id: `S${Date.now().toString(36).toUpperCase()}`,
    fecha: datos.fecha, cliente: datos.cliente, lineas: datos.lineas,
    registradoPor: datos.registradoPor, creadoEn: new Date().toISOString(),
  };
  if (previa >= 0) {
    a.sobras[previa] = sobra;
    log('Sobras', `Recuento sustituido: ${datos.cliente} ${datos.fecha}`);
  } else {
    a.sobras.push(sobra);
    log('Sobras', `Anotadas sobras de ${datos.cliente} ${datos.fecha}: ${datos.lineas.length} líneas`);
  }
  guardar();
  return sobra;
}

export function sobrasDe(cliente: string, fecha: string): Sobra | undefined {
  return cargar().sobras.find(s => s.cliente === cliente && s.fecha === fecha);
}

export function sobrasDelDia(fecha: string): Sobra[] {
  return cargar().sobras.filter(s => s.fecha === fecha);
}

export function todas(): Sobra[] {
  return cargar().sobras;
}

// ── Ajuste de producción ──────────────────────────────────────────────────────

export interface Sugerencia {
  producto: string;
  sku?: string;
  entregadoMedio: number;
  sobraMedia: number;
  vendidoMedio: number;
  sugerido: number;
  diasConSobras: number;      // sobre cuántos recuentos se calcula
}

// Redondeo al alza: si la media dice 6,2 barras, se hacen 7. Quedarse corto
// deja a un cliente sin pan; pasarse deja una barra, que es más barato.
function redondear(n: number): number {
  return Math.max(0, Math.ceil(n - 0.001));
}

// Sugerencia por producto para un cliente y un día de la semana.
//
// El margen es deliberado: se sugiere lo VENDIDO medio, sin colchón. El
// colchón que había ya está dentro de "entregado", y es justo lo que se quiere
// quitar. Si un producto no tiene ningún recuento de sobras, se deja lo
// entregado tal cual y se avisa: sin datos no hay ajuste que valga.
export function sugerirParaDia(
  entregas: historico.Entrega[], cliente: string, dow: number, desde?: string
): Sugerencia[] {
  const medias = historico.mediaPorDia(entregas, cliente, dow, desde);
  const recuentos = cargar().sobras.filter(s =>
    s.cliente === cliente && historico.diaSemana(s.fecha) === dow && (!desde || s.fecha >= desde));

  return medias.map(m => {
    const conEste = recuentos.filter(r =>
      r.lineas.some(l => (l.sku && l.sku === m.sku) || l.producto === m.producto));
    const totalSobras = conEste.reduce((t, r) => {
      const l = r.lineas.find(x => (x.sku && x.sku === m.sku) || x.producto === m.producto);
      return t + (l?.cantidad ?? 0);
    }, 0);
    const sobraMedia = conEste.length ? totalSobras / conEste.length : 0;
    const vendidoMedio = Math.max(0, m.media - sobraMedia);

    return {
      producto: m.producto,
      ...(m.sku ? { sku: m.sku } : {}),
      entregadoMedio: m.media,
      sobraMedia,
      vendidoMedio,
      sugerido: conEste.length ? redondear(vendidoMedio) : redondear(m.media),
      diasConSobras: conEste.length,
    };
  });
}

export function textoSugerencia(cliente: string, dow: number, s: Sugerencia[]): string {
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  if (!s.length) return `No hay entregas registradas a ${cliente} en ${DIAS[dow]}.`;

  let txt = `📊 ${cliente} — ${DIAS[dow]}\n\n`;
  let sinDatos = 0;
  for (const p of s) {
    txt += `${p.producto}\n`;
    txt += `   entregado ${p.entregadoMedio.toFixed(1)}`;
    if (p.diasConSobras) {
      txt += ` · sobra ${p.sobraMedia.toFixed(1)} · vendido ${p.vendidoMedio.toFixed(1)}\n`;
      txt += `   → producir ${p.sugerido} (${p.diasConSobras} recuento(s))\n`;
    } else {
      txt += ` · sin recuentos de sobras\n   → dejar ${p.sugerido}\n`;
      sinDatos += 1;
    }
  }
  if (sinDatos) {
    txt += `\n⚠️ ${sinDatos} producto(s) sin ningún recuento: ahí no hay ajuste, solo lo que se entrega hoy.`;
  }
  return txt;
}

// Solo para tests.
export function _reset(): void { cache = null; }
