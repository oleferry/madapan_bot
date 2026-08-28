import { getInvoicingV1Client } from './holdedClient';
import { log } from '../utils/logger';

// Ventas del mostrador, sacadas de los tickets de Holded.
//
// Para la tienda esto sustituye al recuento de sobras: no hace falta contar lo
// que sobró si se sabe lo que se vendió. Comprobado contra un día real: el
// 26/08 salieron 40 panes de cuadros a la tienda y los tickets suman 35.
//
// Dos avisos sobre lo que este número NO es:
//  - El pan de ayer se puede vender hoy, así que "servido − vendido" no es
//    exactamente lo que se tiró.
//  - Los tickets llevan café, refrescos y demás; aquí solo interesan los
//    productos que están en la hoja, y el resto se ignora solo.
//
// Lo que sí es, y es lo que hace falta: cuántas piezas se vendieron ese día.

const POR_PAGINA = 500;
const PAGINAS_MAX = 40;

export function normalizar(s: string): string {
  return (s ?? '').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

export interface VentaMostrador {
  fecha: string;
  porProducto: Map<string, number>;   // clave: SKU si lo hay, si no el nombre normalizado
}

// Descarga tickets hasta pasarse de "desde". Holded los devuelve del más
// reciente al más antiguo, así que se puede parar en cuanto se pasa: bajar las
// 30 páginas enteras para mirar una semana sería absurdo.
export async function ventasDesde(desde: string): Promise<Map<string, VentaMostrador>> {
  const cliente = getInvoicingV1Client();
  const porDia = new Map<string, VentaMostrador>();
  let leidos = 0;

  for (let p = 1; p <= PAGINAS_MAX; p++) {
    const r = await cliente.get<any[]>(`/documents/salesreceipt?page=${p}`);
    const datos = r.data ?? [];
    if (!datos.length) break;

    let todosViejos = true;
    for (const d of datos) {
      const fecha = new Date(d.date * 1000).toISOString().slice(0, 10);
      if (fecha < desde) continue;
      todosViejos = false;
      leidos++;

      const dia = porDia.get(fecha) ?? { fecha, porProducto: new Map<string, number>() };
      for (const l of (d.products ?? [])) {
        const unidades = Number(l.units) || 0;
        if (!unidades) continue;
        const clave = l.sku || normalizar(l.name);
        dia.porProducto.set(clave, (dia.porProducto.get(clave) ?? 0) + unidades);
        // También por nombre, para poder cruzar cuando el ticket no trae SKU.
        if (l.sku) {
          const porNombre = normalizar(l.name);
          dia.porProducto.set(porNombre, (dia.porProducto.get(porNombre) ?? 0) + unidades);
        }
      }
      porDia.set(fecha, dia);
    }
    // Página entera anterior a la fecha buscada: lo que queda es aún más viejo.
    if (todosViejos && datos.length === POR_PAGINA) break;
    if (datos.length < POR_PAGINA) break;
  }

  log('Tickets', `${leidos} tickets desde ${desde}, ${porDia.size} días`);
  return porDia;
}

export function vendido(dia: VentaMostrador | undefined, sku: string, nombre: string): number {
  if (!dia) return 0;
  return dia.porProducto.get(sku) ?? dia.porProducto.get(normalizar(nombre)) ?? 0;
}
