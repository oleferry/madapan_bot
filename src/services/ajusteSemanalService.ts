import * as fs from 'fs';
import * as path from 'path';
import * as historico from './historicoVentas';
import * as ps from './pedidosSemanaService';
import * as sobrasService from './sobrasService';
import * as tickets from './ticketsService';
import { log } from '../utils/logger';

// Ajuste semanal de cantidades a partir de lo que de verdad se vende.
//
// En los albaranes de los clientes de reparto las sobras se apuntan en
// NEGATIVO, y son las del día ANTERIOR: la línea "-6 Barra" del albarán del
// martes es el pan que sobró del lunes. Por eso la devolución no se resta del
// día en que aparece, sino del anterior; si no, se estaría penalizando al día
// equivocado y el ajuste bailaría de un día para otro.
//
//   venta real del lunes = servido el lunes − devuelto el martes
//   sugerido             = venta real × 1,10, redondeado al alza
//
// Ese 10 % es el colchón que pidió Madapan: mejor que sobre una barra a que un
// cliente se quede sin pan a media mañana. Si de un producto no volvió nada,
// la venta es todo lo servido y el sugerido sube ese 10 %: es la señal de que
// pudo haberse vendido más.
//
// El redondeo es al MÁS CERCANO, no al alza. Redondear siempre arriba en cada
// una de las 362 celdas añadía otras 150 piezas por semana: el colchón del
// 10 % acababa siendo del 17 % sin que nadie lo hubiera decidido.
//
// La comparación es contra el MISMO día de la SEMANA ANTERIOR, no contra una
// media de meses: así el ajuste sigue a lo que pasa ahora y no arrastra el
// verano entero.
//
// La tienda propia es el caso raro: su albarán no lleva negativos, así que sus
// devoluciones salen de los recuentos de /sobras. Y ahí hay una diferencia que
// importa: NO tener recuento no es lo mismo que no haber devuelto nada. Si se
// tratara igual, cada semana sin contar sobras subiría la producción un 10 %
// sin que nadie lo pidiera.

export const MARGEN = 1.10;

export interface AjusteProducto {
  producto: string;
  sku: string;
  servidoMedio: number;
  devueltoMedio: number;
  ventaMedia: number;
  sugerido: number;
  semanas: number;          // sobre cuántas semanas se calcula
}

function siguienteDia(fecha: string): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ps.DIAS empieza en lunes; JavaScript numera la semana empezando en domingo.
// Mezclarlos corría todo un día: a la fila del lunes se le aplicaban las
// ventas del domingo. Toda conversión entre índice de DIAS y día JS pasa por
// aquí.
export function diaJs(indiceDia: number): number {
  return (indiceDia + 1) % 7;
}

// Última fecha con ese día de la semana, anterior a la de referencia.
export function ultimoDiaSemana(hoy: string, dow: number): string {
  const d = new Date(`${hoy}T12:00:00Z`);
  do {
    d.setUTCDate(d.getUTCDate() - 1);
  } while (d.getUTCDay() !== dow);
  return d.toISOString().slice(0, 10);
}

// Venta real por producto de un cliente en un día de la semana.
export function ventaRealPorDia(
  entregas: historico.Entrega[], cliente: string, dow: number, desde?: string
): AjusteProducto[] {
  const suyas = entregas.filter(e => e.cliente === cliente && (!desde || e.fecha >= desde));
  const porFecha = new Map(suyas.map(e => [e.fecha, e]));
  const delDia = suyas.filter(e => historico.diaSemana(e.fecha) === dow);

  const m = new Map<string, { producto: string; sku: string; servido: number; devuelto: number; dias: Set<string> }>();

  for (const e of delDia) {
    for (const l of historico.servido(e)) {
      const k = l.sku || l.name;
      const v = m.get(k) ?? { producto: l.name, sku: l.sku, servido: 0, devuelto: 0, dias: new Set<string>() };
      v.servido += l.units;
      v.dias.add(e.fecha);
      m.set(k, v);
    }
    // La devolución que corresponde a ESTE día viene en el albarán siguiente.
    const siguiente = porFecha.get(siguienteDia(e.fecha));
    if (!siguiente) continue;
    for (const l of historico.devuelto(siguiente)) {
      const k = l.sku || l.name;
      const v = m.get(k);
      // Si devuelven algo que ese día no se sirvió, no es de este día: se
      // ignora en vez de inventar una venta negativa.
      if (!v) continue;
      v.devuelto += l.units;
    }
  }

  return [...m.values()]
    .map(v => {
      const semanas = v.dias.size;
      const servidoMedio = semanas ? v.servido / semanas : 0;
      const devueltoMedio = semanas ? v.devuelto / semanas : 0;
      const ventaMedia = Math.max(0, servidoMedio - devueltoMedio);
      return {
        producto: v.producto, sku: v.sku, servidoMedio, devueltoMedio, ventaMedia,
        sugerido: Math.max(0, Math.round(ventaMedia * MARGEN)),
        semanas,
      };
    })
    .sort((a, b) => b.ventaMedia - a.ventaMedia);
}

const TIENDA = process.env['PUNTO_PROPIO'] ?? 'Madapan';

export interface VentaDia {
  producto: string;
  sku: string;
  servido: number;
  devuelto: number;
  venta: number;
  sugerido: number;
  fecha: string;            // el día concreto del que sale
  hayDatoDevolucion: boolean;
}

// Venta de un cliente en el MISMO día de la semana pasada.
//
// "hayDatoDevolucion" separa dos cosas que se confunden fácil: que no volviera
// nada (devuelto 0, sube el 10 %) y que no sepamos si volvió algo. Lo segundo
// no se toca.
export function ventaSemanaAnterior(
  entregas: historico.Entrega[], cliente: string, dow: number, hoy: string,
  ventasMostrador?: Map<string, tickets.VentaMostrador>
): VentaDia[] {
  const fecha = ultimoDiaSemana(hoy, dow);
  const suyas = entregas.filter(e => e.cliente === cliente);
  const dia = suyas.find(e => e.fecha === fecha);
  if (!dia) return [];

  const esTienda = ps.normalizar(cliente) === ps.normalizar(TIENDA);

  // Tienda: lo mejor es el ticket, que dice lo VENDIDO sin que nadie cuente
  // nada. Si ese día no hay tickets, se cae al recuento de /sobras.
  // Reparto: la devolución viene en el albarán del día siguiente.
  const siguiente = suyas.find(e => e.fecha === siguienteDia(fecha));
  const delMostrador = esTienda ? ventasMostrador?.get(fecha) : undefined;
  const recuento = esTienda && !delMostrador ? sobrasService.sobrasDe(cliente, fecha) : undefined;
  const hayDato = esTienda
    ? Boolean(delMostrador) || Boolean(recuento)
    : Boolean(siguiente);

  const devueltoPor = new Map<string, number>();
  if (esTienda) {
    for (const l of recuento?.lineas ?? []) {
      devueltoPor.set(l.sku || l.producto, l.cantidad);
    }
  } else if (siguiente) {
    for (const l of historico.devuelto(siguiente)) {
      devueltoPor.set(l.sku || l.name, (devueltoPor.get(l.sku || l.name) ?? 0) + l.units);
    }
  }

  return historico.servido(dia).map(l => {
    const k = l.sku || l.name;
    // Con tickets, la venta se lee directamente y la "devolución" es lo que
    // sale de restar: es información derivada, no un dato aparte.
    if (delMostrador) {
      const venta = tickets.vendido(delMostrador, l.sku, l.name);
      return {
        producto: l.name, sku: l.sku, servido: l.units,
        devuelto: Math.max(0, l.units - venta), venta,
        sugerido: Math.max(0, Math.round(venta * MARGEN)),
        fecha, hayDatoDevolucion: true,
      };
    }
    const devuelto = devueltoPor.get(k) ?? devueltoPor.get(l.name) ?? 0;
    const venta = Math.max(0, l.units - devuelto);
    return {
      producto: l.name, sku: l.sku, servido: l.units, devuelto, venta,
      sugerido: Math.max(0, Math.round(venta * MARGEN)),
      fecha, hayDatoDevolucion: hayDato,
    };
  }).sort((a, b) => b.venta - a.venta);
}

export interface RevisionCliente {
  cliente: string;
  punto: string;                 // nombre en la hoja
  productos: Array<AjusteProducto & { enHoja: number; fila?: number; dia: string }>;
}

// Compara la venta de la semana pasada con lo que hay puesto en la hoja.
export interface Revision {
  cambios: ps.Cambio[];
  bruscos: ps.Cambio[];        // saltos grandes: se listan, no se aplican
  sinDato: string[];           // días sin recuento de devoluciones
  fijos: string[];             // clientes de pedido fijo, intocados
}

// Lista de clientes de pedido fijo, escrita a mano en data/clientes-fijos.json.
//
// Se decidió a mano y no por los datos porque los datos no siempre aciertan:
// La Panera figura con un 19 % de devoluciones en sus albaranes y aun así su
// pedido es fijo, así que esos negativos son otra cosa. Y al revés, un cliente
// puede no haber devuelto nada en dos meses por casualidad.
const RUTA_FIJOS = process.env['CLIENTES_FIJOS_PATH']
  ?? path.join(process.cwd(), 'data', 'clientes-fijos.json');

let patronesFijos: string[] | null = null;

export function patrones(): string[] {
  if (patronesFijos) return patronesFijos;
  try {
    const j = JSON.parse(fs.readFileSync(RUTA_FIJOS, 'utf-8')) as { fijos?: string[] };
    patronesFijos = j.fijos ?? [];
  } catch {
    patronesFijos = [];
  }
  return patronesFijos;
}

// ¿Es de pedido fijo? Vale que encaje el nombre del punto o el del cliente.
export function esFijo(...nombres: string[]): boolean {
  return patrones().some(pat => {
    const suyas = ps.palabras(pat);
    return suyas.length > 0 && nombres.some(n => {
      const dentro = new Set(ps.palabras(n));
      return suyas.every(w => dentro.has(w));
    });
  });
}

// Solo para diagnóstico: clientes que nunca devuelven nada. Un bar o una
// residencia piden lo mismo cada día y lo venden todo, así que ajustarles la
// cantidad por la venta de una semana es meterse donde no toca. Se detectan
// solos: cero devoluciones en el periodo mirado.
//
// La tienda propia es la excepción: tampoco tiene devoluciones en el albarán,
// pero no porque lo venda todo, sino porque las suyas están en los tickets.
export function clientesFijos(entregas: historico.Entrega[], desde: string): Set<string> {
  const servido = new Map<string, number>();
  const devuelto = new Map<string, number>();
  for (const e of entregas.filter(x => x.fecha >= desde)) {
    servido.set(e.cliente, (servido.get(e.cliente) ?? 0) + historico.servido(e).reduce((t, l) => t + l.units, 0));
    devuelto.set(e.cliente, (devuelto.get(e.cliente) ?? 0) + historico.devuelto(e).reduce((t, l) => t + l.units, 0));
  }
  const fijos = new Set<string>();
  for (const [cliente, s] of servido) {
    if (ps.normalizar(cliente) === ps.normalizar(TIENDA)) continue;
    if (s > 0 && (devuelto.get(cliente) ?? 0) === 0) fijos.add(cliente);
  }
  return fijos;
}

export function revisarSemanaAnterior(
  entregas: historico.Entrega[],
  filas: ps.FilaPedido[],
  hoy: string,
  opciones: {
    minDiferencia?: number;
    saltoMaximo?: number;
    ventasMostrador?: Map<string, tickets.VentaMostrador>;
    fijos?: Set<string>;
  } = {}
): Revision {
  const minDiferencia = opciones.minDiferencia ?? 1;
  const saltoMaximo = opciones.saltoMaximo ?? 0.4;

  const cambios: ps.Cambio[] = [];
  const bruscos: ps.Cambio[] = [];
  const sinDato = new Set<string>();
  const fijosTocados = new Set<string>();
  const fijos = opciones.fijos ?? new Set<string>();

  const nombres = historico.clientes(entregas).map(c => c.cliente);
  const { mapa } = emparejarPuntos(ps.puntos(filas), nombres);

  for (const punto of ps.puntos(filas)) {
    const cliente = mapa.get(punto);
    if (!cliente) continue;
    if (fijos.has(cliente) || esFijo(punto, cliente)) { fijosTocados.add(punto); continue; }

    for (let i = 0; i < 7; i++) {
      const dia = ps.DIAS[i]!;
      for (const v of ventaSemanaAnterior(entregas, cliente, diaJs(i), hoy, opciones.ventasMostrador)) {
        if (!v.hayDatoDevolucion) {
          // Sin saber si volvió algo, subir un 10 % sería inventar.
          sinDato.add(`${punto} — ${dia} (${v.fecha})`);
          continue;
        }
        const fila = filas.find(f => f.punto === punto && ps.esMismoDia(f.dia, dia)
          && ps.normalizar(f.producto) === ps.normalizar(v.producto));
        if (!fila || Math.abs(fila.cantidad - v.sugerido) < minDiferencia) continue;

        const cambio: ps.Cambio = {
          fila: fila.fila, punto, dia, producto: fila.producto,
          actual: fila.cantidad, nuevo: v.sugerido,
          motivo: `${v.fecha}: sirvió ${v.servido}, volvieron ${v.devuelto}`,
        };
        const salto = fila.cantidad > 0
          ? Math.abs(fila.cantidad - v.sugerido) / fila.cantidad : 1;
        (salto > saltoMaximo ? bruscos : cambios).push(cambio);
      }
    }
  }
  log('AjusteSemanal', `${cambios.length} cambios, ${bruscos.length} bruscos, ` +
    `${sinDato.size} sin dato, ${fijosTocados.size} de pedido fijo`);
  return { cambios, bruscos, sinDato: [...sinDato], fijos: [...fijosTocados] };
}

// Cómo quedaría Pedidos_semana si se aplicaran los cambios: la hoja entera,
// no solo el diff. Es lo que hay que poder mirar antes de escribir.
export function previsualizar(filas: ps.FilaPedido[], cambios: ps.Cambio[]): string {
  const nuevoPorFila = new Map(cambios.map(c => [c.fila, c.nuevo]));
  const porPunto = new Map<string, ps.FilaPedido[]>();
  for (const f of filas) porPunto.set(f.punto, [...(porPunto.get(f.punto) ?? []), f]);

  let txt = '';
  for (const [punto, suyas] of porPunto) {
    const tocadas = suyas.filter(f => nuevoPorFila.has(f.fila));
    if (!tocadas.length) continue;

    txt += `
— ${punto} —
`;
    const productos = [...new Set(suyas.map(f => f.producto))];
    txt += '   ' + 'producto'.padEnd(22) + ps.DIAS.map(d => d.slice(0, 3).padStart(6)).join('') + '\n';
    for (const prod of productos) {
      const celdas = ps.DIAS.map(d => {
        const f = suyas.find(x => x.producto === prod && ps.esMismoDia(x.dia, d));
        if (!f) return '     ·';
        const nuevo = nuevoPorFila.get(f.fila);
        return (nuevo === undefined ? String(f.cantidad) : `${f.cantidad}→${nuevo}`).padStart(6);
      });
      // Solo los productos que cambian en algún día: lo demás es ruido.
      if (!celdas.some(c => c.includes('→'))) continue;
      txt += '   ' + prod.slice(0, 21).padEnd(22) + celdas.join('') + '\n';
    }
  }
  return txt.trim() || 'No cambia ninguna celda.';
}

// Empareja los puntos de la hoja con los clientes de Holded.
//
// Antes bastaba una palabra larga en común, y eso emparejó "RESTAURANTE EL
// ARCO - ÁNGEL LÓPEZ GARCÍA" con "Mariano Jorge Esteban García": "garcia" la
// comparten media docena de clientes. Se le aplicaron a un cliente las ventas
// de otro.
//
// Ahora solo cuentan las palabras DISTINTIVAS —las que aparecen en uno o dos
// nombres de toda la lista— y hace falta un ganador claro. Sin eso, el punto
// se queda sin emparejar, que es mucho mejor que emparejarlo mal.
export function emparejarPuntos(
  puntos: string[], clientes: string[]
): { mapa: Map<string, string>; ambiguos: string[] } {
  const frecuencia = new Map<string, number>();
  for (const c of clientes) {
    for (const p of new Set(ps.palabras(c))) {
      frecuencia.set(p, (frecuencia.get(p) ?? 0) + 1);
    }
  }
  const distintiva = (p: string): boolean => (frecuencia.get(p) ?? 0) <= 2;

  const mapa = new Map<string, string>();
  const ambiguos: string[] = [];

  for (const punto of puntos) {
    const suyas = new Set(ps.palabras(punto));
    const puntuados = clientes
      .map(c => ({
        cliente: c,
        puntos: ps.palabras(c).filter(p => suyas.has(p) && distintiva(p)).length,
      }))
      .filter(x => x.puntos > 0)
      .sort((a, b) => b.puntos - a.puntos);

    if (!puntuados.length) continue;
    // Empate en la primera posición: no se elige a ojo.
    if (puntuados.length > 1 && puntuados[1]!.puntos === puntuados[0]!.puntos) {
      ambiguos.push(`${punto} → ${puntuados.slice(0, 3).map(x => x.cliente).join(' / ')}`);
      continue;
    }
    mapa.set(punto, puntuados[0]!.cliente);
  }
  return { mapa, ambiguos };
}

export function textoRevision(
  revisiones: RevisionCliente[], cambios: ps.Cambio[], bruscos: ps.Cambio[] = []
): string {
  if (!cambios.length && !bruscos.length) {
    return `✅ Revisadas las ventas reales de ${revisiones.length} punto(s). ` +
      'Las cantidades de la hoja se ajustan a lo que se vende; no hace falta tocar nada.';
  }
  let txt = '📉 *AJUSTE POR VENTA REAL*\n\n';
  txt += '(servido − devuelto del día siguiente, +10 % de colchón)\n\n';
  txt += ps.textoCambios(cambios);

  const ahorro = cambios.reduce((t, c) => t + Math.max(0, c.actual - c.nuevo), 0);
  const subida = cambios.reduce((t, c) => t + Math.max(0, c.nuevo - c.actual), 0);
  txt += `\n\nEn total: ${ahorro} pieza(s) menos y ${subida} más a la semana.`;

  if (bruscos.length) {
    txt += '\n\n⚠️ Estos NO se aplican, míralos tú (saltan más de un 40 %, ' +
      'suele ser un cliente que cerró unos días):\n' + ps.textoCambios(bruscos);
  }
  return txt;
}
