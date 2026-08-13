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
