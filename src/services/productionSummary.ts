import { listAllOrdersForDate } from './holdedClient';
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

  if (orders.length === 0) {
    return `📦 Producción ${dateStr} (${dayName})\n\nNo se encontraron pedidos para este día.`;
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

  return text;
}
