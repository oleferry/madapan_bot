import * as historico from './historicoVentas';
import * as ps from './pedidosSemanaService';
import * as sobrasService from './sobrasService';
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
        sugerido: Math.max(0, Math.ceil(ventaMedia * MARGEN - 0.001)),
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
  entregas: historico.Entrega[], cliente: string, dow: number, hoy: string
): VentaDia[] {
  const fecha = ultimoDiaSemana(hoy, dow);
  const suyas = entregas.filter(e => e.cliente === cliente);
  const dia = suyas.find(e => e.fecha === fecha);
  if (!dia) return [];

  const esTienda = ps.normalizar(cliente) === ps.normalizar(TIENDA);

  // Reparto: la devolución viene en el albarán del día siguiente.
  // Tienda: viene del recuento de /sobras de ese mismo día.
  const siguiente = suyas.find(e => e.fecha === siguienteDia(fecha));
  const recuento = esTienda ? sobrasService.sobrasDe(cliente, fecha) : undefined;
  const hayDato = esTienda ? Boolean(recuento) : Boolean(siguiente);

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
    const devuelto = devueltoPor.get(k) ?? devueltoPor.get(l.name) ?? 0;
    const venta = Math.max(0, l.units - devuelto);
    return {
      producto: l.name, sku: l.sku, servido: l.units, devuelto, venta,
      sugerido: Math.max(0, Math.ceil(venta * MARGEN - 0.001)),
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
}

export function revisarSemanaAnterior(
  entregas: historico.Entrega[],
  filas: ps.FilaPedido[],
  hoy: string,
  opciones: { minDiferencia?: number; saltoMaximo?: number } = {}
): Revision {
  const minDiferencia = opciones.minDiferencia ?? 1;
  const saltoMaximo = opciones.saltoMaximo ?? 0.4;

  const cambios: ps.Cambio[] = [];
  const bruscos: ps.Cambio[] = [];
  const sinDato = new Set<string>();

  const nombres = historico.clientes(entregas).map(c => c.cliente);

  for (const punto of ps.puntos(filas)) {
    const cliente = nombres.find(c => ps.buscarPunto(filas, c).includes(punto) || emparejan(c, punto));
    if (!cliente) continue;

    for (let dow = 0; dow < 7; dow++) {
      const dia = ps.DIAS[dow]!;
      for (const v of ventaSemanaAnterior(entregas, cliente, dow, hoy)) {
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
  log('AjusteSemanal', `${cambios.length} cambios, ${bruscos.length} bruscos, ${sinDato.size} sin dato`);
  return { cambios, bruscos, sinDato: [...sinDato] };
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

function emparejan(a: string, b: string): boolean {
  const pa = new Set(ps.palabras(a));
  const pb = ps.palabras(b);
  return pb.length > 0 && pb.some(p => pa.has(p) && p.length > 4);
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
