import * as historico from './historicoVentas';
import * as ps from './pedidosSemanaService';
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
// cliente se quede sin pan a media mañana.

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

// La tienda propia se queda fuera: su albarán NO lleva negativos, así que su
// "venta real" saldría igual a lo servido y el +10 % inflaría la producción
// cada semana. Sus sobras vienen de /sobras, por otro camino.
const TIENDA = process.env['PUNTO_PROPIO'] ?? 'Madapan';

export interface RevisionCliente {
  cliente: string;
  punto: string;                 // nombre en la hoja
  productos: Array<AjusteProducto & { enHoja: number; fila?: number; dia: string }>;
}

// Compara la venta real con lo que hay puesto en Pedidos_semana y devuelve los
// cambios que harían falta. Solo se propone lo que se aparta de verdad: mover
// una cantidad por media unidad es ruido.
export function revisar(
  entregas: historico.Entrega[],
  filas: ps.FilaPedido[],
  opciones: { desde?: string; minSemanas?: number; minDiferencia?: number } = {}
): { revisiones: RevisionCliente[]; cambios: ps.Cambio[]; bruscos: ps.Cambio[] } {
  const minSemanas = opciones.minSemanas ?? 3;
  const minDiferencia = opciones.minDiferencia ?? 2;

  const revisiones: RevisionCliente[] = [];
  const cambios: ps.Cambio[] = [];
  const bruscos: ps.Cambio[] = [];

  for (const punto of ps.puntos(filas)) {
    if (ps.normalizar(punto) === ps.normalizar(TIENDA)) continue;
    // El nombre de la hoja y el de Holded no son iguales; se cruza por palabras.
    const cliente = historico.clientes(entregas)
      .map(c => c.cliente)
      .find(c => ps.buscarPunto(filas, c).includes(punto) || emparejan(c, punto));
    if (!cliente) continue;

    const productos: RevisionCliente['productos'] = [];

    for (let dow = 0; dow < 7; dow++) {
      const dia = ps.DIAS[dow]!;
      const reales = ventaRealPorDia(entregas, cliente, dow, opciones.desde);
      for (const r of reales) {
        if (r.semanas < minSemanas) continue;
        const fila = filas.find(f => f.punto === punto && ps.esMismoDia(f.dia, dia)
          && ps.normalizar(f.producto) === ps.normalizar(r.producto));
        if (!fila) continue;
        productos.push({ ...r, enHoja: fila.cantidad, fila: fila.fila, dia });
        if (Math.abs(fila.cantidad - r.sugerido) >= minDiferencia) {
          const cambio: ps.Cambio = {
            fila: fila.fila, punto, dia, producto: fila.producto,
            actual: fila.cantidad, nuevo: r.sugerido,
            motivo: `venta real ${r.ventaMedia.toFixed(1)} +10% (${r.semanas} sem)`,
          };
          // Un salto de más del 40 % no se propone para aplicar a ciegas: casi
          // siempre es un cliente que cerró unos días o una devolución rara,
          // no un cambio de verdad en lo que vende.
          const salto = fila.cantidad > 0
            ? Math.abs(fila.cantidad - r.sugerido) / fila.cantidad : 1;
          (salto > 0.4 ? bruscos : cambios).push(cambio);
        }
      }
    }
    if (productos.length) revisiones.push({ cliente, punto, productos });
  }

  log('AjusteSemanal', `${revisiones.length} clientes, ${cambios.length} cambios, ${bruscos.length} para revisar`);
  return { revisiones, cambios, bruscos };
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
