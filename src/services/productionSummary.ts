import { listAllOrdersForDate } from './holdedClient';
import * as encargos from './encargosService';
import { log } from '../utils/logger';

const DAY_NAMES: Record<number, string> = {
  0: 'Domingo', 1: 'Lunes', 2: 'Martes', 3: 'Miércoles',
  4: 'Jueves', 5: 'Viernes', 6: 'Sábado',
};

export async function buildProductionSummary(
  dateStr: string,
  dayOfWeek: number
): Promise<string> {
  const dayName = DAY_NAMES[dayOfWeek] ?? '';
  const orders = await listAllOrdersForDate(dateStr);
  // Los encargos sueltos no están en Holded, viven en el bot. Al obrador le da
  // igual de dónde venga cada pieza: tienen que salir en el mismo resumen.
  const textoEncargos = encargos.textoProduccion(dateStr);

  if (orders.length === 0) {
    const vacio = `📦 Producción ${dateStr} (${dayName})\n\nNo hay pedidos de clientes para este día.`;
    return textoEncargos ? vacio + '\n' + textoEncargos : vacio;
  }

  // Sumar cantidades por nombre de producto
  const totals = new Map<string, number>();
  for (const order of orders) {
    for (const line of order.lines) {
      if (line.units <= 0) continue;
      totals.set(line.name, (totals.get(line.name) ?? 0) + line.units);
    }
  }

  const lines = [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, qty]) => `  ${name}: ${qty}`);

  log('ProductionSummary', `${dateStr}: ${orders.length} pedidos, ${totals.size} productos`);

  let text = `📦 Producción ${dateStr} (${dayName})\n`;
  text += `${orders.length} pedido(s)\n\n`;
  text += lines.join('\n');
  if (textoEncargos) text += '\n' + textoEncargos;

  return text;
}

// Productos que se producen ese día: pedidos de Holded más encargos.
//
// "soloCliente" limita a un punto concreto. Para contar sobras hay que pasar
// la tienda: lo que se hornea para los puntos de reparto va en su albarán y no
// se cuenta aquí. Sin filtro, /sobras preguntaba por los 11 productos de toda
// la producción en vez de por los 4 o 5 del mostrador.
export async function productosDelDia(
  dateStr: string,
  soloCliente?: string
): Promise<Array<{ producto: string; sku?: string; units: number }>> {
  const totales = new Map<string, { producto: string; sku?: string; units: number }>();
  const suyo = (nombre: string): boolean =>
    !soloCliente || nombre.toLowerCase().includes(soloCliente.toLowerCase());

  for (const order of await listAllOrdersForDate(dateStr)) {
    if (!suyo(order.contactName ?? '')) continue;
    for (const line of order.lines) {
      if (line.units <= 0) continue;
      const clave = line.name.toLowerCase().trim();
      const t = totales.get(clave) ?? { producto: line.name, ...(line.sku ? { sku: line.sku } : {}), units: 0 };
      t.units += line.units;
      totales.set(clave, t);
    }
  }

  for (const e of encargos.totalesDelDia(dateStr)) {
    const clave = e.producto.toLowerCase().trim();
    const t = totales.get(clave) ?? { producto: e.producto, units: 0 };
    t.units += e.cantidad;
    totales.set(clave, t);
  }

  return [...totales.values()].sort((a, b) => b.units - a.units);
}
