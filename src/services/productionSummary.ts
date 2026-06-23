import * as fs from 'fs';
import * as path from 'path';
import { listAllOrdersForDate } from './holdedClient';
import { log, warn } from '../utils/logger';

// Mapeo de nombres de producto Holded → nombre en weekly-base.json
// Las claves son fragmentos del nombre en Holded (lowercase), el valor es la clave en la base
const NAME_MAP: Record<string, string> = {
  'barra pequeña': 'Barra pequeña',
  'barra de picos': 'Barra de picos',
  'barra': 'Barra',
  'chapata': 'Chapata',
  'hogaza mm centeno': 'Hogaza MM centeno',
  'hogaza mm semillas': 'Hogaza MM centeno', // agrupamos semillas con centeno si no hay clave propia
  'hogaza': 'Hogaza',
  'pan de canteros': 'Pan de canteros',
  'pan de cuadros': 'Pan de cuadros',
  'pan integral': 'Pan integral',
  'pan pequeño': 'Pan pequeño',
  'pan pasas': 'Pan pasas y nueces',
  'torta de aceite': 'Torta de aceite',
};

const DAY_NAMES: Record<number, string> = {
  0: 'Domingo',
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado',
};

function resolveProductName(holdedName: string): string | null {
  const lower = holdedName.toLowerCase();
  // Ordenar por longitud descendente para que coincidencias más específicas ganen
  const keys = Object.keys(NAME_MAP).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (lower.includes(key)) return NAME_MAP[key]!;
  }
  return null;
}

function loadWeeklyBase(): Record<string, Record<string, number>> | null {
  const basePath = path.join(process.cwd(), 'data', 'weekly-base.json');
  try {
    const raw = fs.readFileSync(basePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    warn('ProductionSummary', `No se pudo cargar weekly-base.json: ${(err as Error).message}`);
    return null;
  }
}

export async function buildProductionSummary(
  dateStr: string,   // YYYY-MM-DD — día de entrega
  dayOfWeek: number  // 0=Dom…6=Sáb
): Promise<string> {
  const dayName = DAY_NAMES[dayOfWeek] ?? 'Lunes';
  const base = loadWeeklyBase();

  const orders = await listAllOrdersForDate(dateStr);

  if (orders.length === 0) {
    return `📦 Producción ${dateStr} (${dayName})\n\nNo se encontraron pedidos para este día.`;
  }

  // Sumar cantidades por nombre de producto (normalizado)
  const totals = new Map<string, number>();
  for (const order of orders) {
    for (const line of order.lines) {
      if (line.units <= 0) continue;
      const canonical = resolveProductName(line.name);
      if (!canonical) continue;
      totals.set(canonical, (totals.get(canonical) ?? 0) + line.units);
    }
  }

  const baseForDay: Record<string, number> = base?.[dayName] ?? {};

  // Recopilar todos los productos (unión de totals y base)
  const allProducts = new Set([...totals.keys(), ...Object.keys(baseForDay)]);

  const lines: string[] = [];
  for (const prod of [...allProducts].sort()) {
    const actual = totals.get(prod) ?? 0;
    const baseQty = baseForDay[prod] ?? 0;
    const delta = actual - baseQty;
    const sign = delta > 0 ? '+' : '';
    const deltaStr = delta !== 0 ? ` (${sign}${delta})` : ' (=)';
    lines.push(`  ${prod}: ${actual}${deltaStr}`);
  }

  let text = `📦 Producción para el ${dateStr} (${dayName})\n`;
  text += `${orders.length} pedido(s) — base: ${dayName}\n\n`;
  text += lines.join('\n');
  text += `\n\n_Entre paréntesis: variación respecto a la base semanal._`;

  return text;
}

export async function buildVariationSummary(
  dateStr: string,
  dayOfWeek: number
): Promise<string> {
  const dayName = DAY_NAMES[dayOfWeek] ?? 'Lunes';
  const base = loadWeeklyBase();
  const orders = await listAllOrdersForDate(dateStr);

  const totals = new Map<string, number>();
  for (const order of orders) {
    for (const line of order.lines) {
      if (line.units <= 0) continue;
      const canonical = resolveProductName(line.name);
      if (!canonical) continue;
      totals.set(canonical, (totals.get(canonical) ?? 0) + line.units);
    }
  }

  const baseForDay: Record<string, number> = base?.[dayName] ?? {};
  const allProducts = new Set([...totals.keys(), ...Object.keys(baseForDay)]);

  const variations: string[] = [];
  for (const prod of [...allProducts].sort()) {
    const actual = totals.get(prod) ?? 0;
    const baseQty = baseForDay[prod] ?? 0;
    const delta = actual - baseQty;
    if (delta === 0) continue;
    const sign = delta > 0 ? '+' : '';
    variations.push(`${sign}${delta} ${prod}`);
  }

  log('ProductionSummary', `Variaciones ${dateStr}: ${variations.length} productos con cambio`);

  if (variations.length === 0) {
    return `📦 Producción ${dateStr} (${dayName})\n\nBase semanal sin variaciones. Todo según lo previsto.`;
  }

  let text = `📦 Variaciones producción ${dateStr} (${dayName})\n`;
  text += `${orders.length} pedido(s)\n\n`;
  text += variations.join('\n');

  return text;
}
