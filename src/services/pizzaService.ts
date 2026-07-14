import * as fs from 'fs';
import * as path from 'path';
import { log, warn } from '../utils/logger';
import { config } from '../config';
import { getTodayDate, formatDateSpanish } from '../utils/dates';

// ── Menu (estático, tracked en git) ──────────────────────────────────────────

export interface PizzaItem {
  id: string;
  name: string;
  ingredientes: string[];
}

export interface PostreItem {
  id: string;
  name: string;
}

export interface PizzaMenu {
  diasDisponibles: string[];
  horaInicio: string;
  horaFin: string;
  pizzas: PizzaItem[];
  postres: PostreItem[];
  precioIndividual: number;
  precioMenu: number;
  menuIncluye: string;
}

let menu: PizzaMenu | null = null;

export function getMenu(): PizzaMenu {
  if (menu) return menu;
  const filePath = path.resolve('data/pizza-menu.json');
  menu = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return menu!;
}

export function getPizzaById(id: string): PizzaItem | null {
  return getMenu().pizzas.find(p => p.id === id) ?? null;
}

export function getPostreById(id: string): PostreItem | null {
  return getMenu().postres.find(p => p.id === id) ?? null;
}

// ── Stock por fin de semana (local, no tracked) ──────────────────────────────
// Ahora que se puede reservar con varias semanas de antelación, el stock se
// guarda POR finde (clave = viernes de ese finde, "YYYY-MM-DD"), no como un
// único estado global.

interface WeekendStock {
  totalDisponible: number;
  usadas: number;
}

type PizzaStockMap = Record<string, WeekendStock>;

const STOCK_PATH = path.resolve(config.pizzaStockPath);

function loadStockMap(): PizzaStockMap {
  try {
    if (!fs.existsSync(STOCK_PATH)) return {};
    const raw = JSON.parse(fs.readFileSync(STOCK_PATH, 'utf-8'));
    // Compatibilidad: el formato antiguo era un único estado plano
    // { weekOf, totalDisponible, usadas } en vez de un mapa por finde.
    if (raw && typeof raw === 'object' && typeof raw.weekOf === 'string' && typeof raw.totalDisponible === 'number') {
      return { [raw.weekOf]: { totalDisponible: raw.totalDisponible, usadas: raw.usadas ?? 0 } };
    }
    return raw && typeof raw === 'object' ? raw : {};
  } catch (err) {
    warn('PizzaService', `Error leyendo stock: ${(err as Error).message}`);
    return {};
  }
}

function saveStockMap(map: PizzaStockMap): void {
  fs.mkdirSync(path.dirname(STOCK_PATH), { recursive: true });
  fs.writeFileSync(STOCK_PATH, JSON.stringify(map, null, 2));
}

// Devuelve el viernes de la semana en curso (o el próximo si hoy ya pasó el finde), "YYYY-MM-DD"
function currentWeekendKey(): string {
  const now = new Date();
  const dow = now.getDay(); // 0=Dom...6=Sáb
  let diffToFriday = 5 - dow;
  if (diffToFriday < -1) diffToFriday += 7; // si ya es domingo pasado el viernes, saltar a siguiente semana
  const friday = new Date(now);
  friday.setDate(now.getDate() + diffToFriday);
  return friday.toISOString().slice(0, 10);
}

// Dado un "YYYY-MM-DD", devuelve la clave de agrupación de stock/pedidos para
// esa fecha: si es viernes/sábado/domingo, el viernes de ESE finde (agrupa los
// 3 días); si es un día suelto (día puntual añadido por el admin, p.ej. un
// martes especial), se agrupa consigo mismo.
export function weekendKeyForPickedDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) throw new Error(`Fecha inválida: ${dateStr}`);
  const date = new Date(y, m - 1, d);
  const dow = date.getDay();
  const diffToFriday = dow === 5 ? 0 : dow === 6 ? -1 : dow === 0 ? -2 : null;
  if (diffToFriday === null) {
    return dateStr; // día puntual suelto — no pertenece a un finde vie/sáb/dom
  }
  date.setDate(date.getDate() + diffToFriday);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Admin: fija el total de bases disponibles para un finde concreto (por defecto, el próximo).
// Conserva las unidades ya vendidas de ese finde si ya existía stock configurado —
// fijar el stock no debe borrar las reservas ya hechas.
export function setWeekendStock(total: number, weekOf: string = currentWeekendKey()): string {
  const map = loadStockMap();
  const usadasPrevias = map[weekOf]?.usadas ?? 0;
  map[weekOf] = { totalDisponible: total, usadas: usadasPrevias };
  saveStockMap(map);
  log('PizzaService', `Stock de pizzas fijado a ${total} para el finde del ${weekOf} (usadas conservadas: ${usadasPrevias})`);
  return weekOf;
}

export function getRemainingStock(weekOf: string = currentWeekendKey()): number | null {
  const entry = loadStockMap()[weekOf];
  if (!entry) return null; // sin stock configurado para ese finde
  return Math.max(0, entry.totalDisponible - entry.usadas);
}

// Descuenta unidades del stock de un finde concreto; devuelve false si no hay suficiente.
export function consumeStock(weekOf: string, units: number): boolean {
  const map = loadStockMap();
  const entry = map[weekOf];
  if (!entry) return true; // sin control de stock configurado para ese finde — se permite

  const restante = entry.totalDisponible - entry.usadas;
  if (restante < units) return false;

  entry.usadas += units;
  saveStockMap(map);
  return true;
}

// Devuelve unidades al stock de un finde concreto (al cancelar una reserva).
function restoreStock(weekOf: string, units: number): void {
  const map = loadStockMap();
  const entry = map[weekOf];
  if (!entry) return;
  entry.usadas = Math.max(0, entry.usadas - units);
  saveStockMap(map);
}

const DIA_NAME_TO_DOW: Record<string, number> = { 'Domingo': 0, 'Viernes': 5, 'Sábado': 6 };
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── Días puntuales (fechas sueltas fuera del patrón semanal vie/sáb/dom) ────
// El admin puede abrir un día concreto (p.ej. "este martes") para reserva
// pública, además del patrón fijo de fin de semana.

const EXTRA_DATES_PATH = path.resolve(config.pizzaExtraDatesPath);

function loadExtraDates(): string[] {
  try {
    if (!fs.existsSync(EXTRA_DATES_PATH)) return [];
    const raw = JSON.parse(fs.readFileSync(EXTRA_DATES_PATH, 'utf-8'));
    return Array.isArray(raw) ? raw : [];
  } catch (err) {
    warn('PizzaService', `Error leyendo días extra: ${(err as Error).message}`);
    return [];
  }
}

function saveExtraDates(dates: string[]): void {
  fs.mkdirSync(path.dirname(EXTRA_DATES_PATH), { recursive: true });
  fs.writeFileSync(EXTRA_DATES_PATH, JSON.stringify(dates, null, 2));
}

// Añade un día puntual reservable. Idempotente.
export function addExtraPizzaDate(dateStr: string): void {
  if (!ISO_DATE_RE.test(dateStr)) throw new Error(`Fecha inválida: ${dateStr}`);
  const dates = loadExtraDates();
  if (!dates.includes(dateStr)) {
    dates.push(dateStr);
    dates.sort();
    saveExtraDates(dates);
  }
  log('PizzaService', `Día puntual de pizza añadido: ${dateStr}`);
}

// Quita un día puntual. Devuelve false si no existía.
export function removeExtraPizzaDate(dateStr: string): boolean {
  const dates = loadExtraDates();
  const idx = dates.indexOf(dateStr);
  if (idx === -1) return false;
  dates.splice(idx, 1);
  saveExtraDates(dates);
  log('PizzaService', `Día puntual de pizza eliminado: ${dateStr}`);
  return true;
}

// Días puntuales vigentes (no pasados), para mostrar en el listado de admin.
export function getExtraPizzaDates(): string[] {
  const today = getTodayDate();
  return loadExtraDates().filter(d => d >= today);
}

// Fechas reservables: el patrón fijo (viernes/sábado/domingo) de las próximas
// `weeksAhead` semanas, más cualquier día puntual añadido por el admin.
export function getPizzaAvailableDates(weeksAhead = 4): string[] {
  const diasDisponibles = getMenu().diasDisponibles;
  const allowedDow = new Set(diasDisponibles.map(d => DIA_NAME_TO_DOW[d]).filter((n): n is number => n !== undefined));

  const today = getTodayDate();
  const [y, m, d] = today.split('-').map(Number);
  const start = new Date(y!, m! - 1, d!);

  const dates = new Set<string>();
  for (let i = 0; i < weeksAhead * 7; i++) {
    const dt = new Date(start);
    dt.setDate(start.getDate() + i);
    if (allowedDow.has(dt.getDay())) {
      const yyyy = dt.getFullYear();
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const dd = String(dt.getDate()).padStart(2, '0');
      dates.add(`${yyyy}-${mm}-${dd}`);
    }
  }
  for (const extra of getExtraPizzaDates()) dates.add(extra);

  return [...dates].sort();
}

// Formatea una fecha de recogida para mostrar; tolera entradas antiguas que
// guardaban solo el nombre del día ("Viernes") sin fecha real.
export function formatPizzaDate(dateStr: string): string {
  return ISO_DATE_RE.test(dateStr) ? formatDateSpanish(dateStr) : dateStr;
}

// ── Log de pedidos de pizza ───────────────────────────────────────────────────

// Una línea del pedido (una variante de pizza con su cantidad)
export interface PizzaOrderItem {
  tipo: 'individual' | 'menu';
  pizzaId: string;
  pizzaName: string;
  postres: string[];
  cantidad: number;
  precioUnidad: number;
}

export interface PizzaOrderEntry {
  orderNumber: string;
  timestamp: string;
  telegramId: string;
  nombre: string;
  telefono: string;
  email: string;
  marketingConsent: boolean;
  items: PizzaOrderItem[];
  cantidadTotal: number;
  precioTotal: number;
  diaRecogida: string;
  horaRecogida: string;
  weekOf: string;
  cancelled?: boolean;
  cancelledAt?: string;
  cancelledBy?: string; // telegramId del cliente o 'admin:<id>'
}

const ORDERS_LOG_PATH = path.resolve(config.pizzaOrdersLogPath);

// Registra el pedido asignándole un número correlativo y devuelve dicho número.
// El finde (weekOf) se calcula a partir de la fecha real de recogida elegida,
// no de "ahora" — necesario para poder reservar con semanas de antelación.
export function logPizzaOrder(entry: Omit<PizzaOrderEntry, 'weekOf' | 'orderNumber'>): string {
  fs.mkdirSync(path.dirname(ORDERS_LOG_PATH), { recursive: true });
  const orderNumber = nextOrderNumber();
  const weekOf = ISO_DATE_RE.test(entry.diaRecogida) ? weekendKeyForPickedDate(entry.diaRecogida) : currentWeekendKey();
  const full: PizzaOrderEntry = { ...entry, orderNumber, weekOf };
  fs.appendFileSync(ORDERS_LOG_PATH, JSON.stringify(full) + '\n');
  return orderNumber;
}

// Número de pedido correlativo global, formato PZ-0001.
function nextOrderNumber(): string {
  const n = readAllOrders().length + 1;
  return `PZ-${String(n).padStart(4, '0')}`;
}

// Normaliza una entrada del log al formato con items[]. Los pedidos antiguos
// guardaban una sola pizza en campos planos (tipo/pizzaId/cantidad/...).
function normalizeOrder(raw: Record<string, unknown>): PizzaOrderEntry {
  const o = raw as Partial<PizzaOrderEntry> & {
    tipo?: 'individual' | 'menu'; pizzaId?: string; pizzaName?: string;
    postres?: string[]; cantidad?: number;
  };

  let items: PizzaOrderItem[];
  if (Array.isArray(o.items)) {
    items = o.items;
  } else if (o.pizzaId) {
    const cantidad = o.cantidad ?? 1;
    const precioUnidad = o.precioTotal && cantidad ? o.precioTotal / cantidad : 0;
    items = [{
      tipo: o.tipo ?? 'individual',
      pizzaId: o.pizzaId,
      pizzaName: o.pizzaName ?? o.pizzaId,
      postres: o.postres ?? [],
      cantidad,
      precioUnidad,
    }];
  } else {
    items = [];
  }

  const cantidadTotal = o.cantidadTotal ?? items.reduce((s, i) => s + i.cantidad, 0);

  return {
    orderNumber: o.orderNumber ?? '',
    timestamp: o.timestamp ?? '',
    telegramId: o.telegramId ?? '',
    nombre: o.nombre ?? '',
    telefono: o.telefono ?? '',
    email: o.email ?? '',
    marketingConsent: o.marketingConsent ?? false,
    items,
    cantidadTotal,
    precioTotal: o.precioTotal ?? 0,
    diaRecogida: o.diaRecogida ?? '',
    horaRecogida: o.horaRecogida ?? '',
    weekOf: o.weekOf ?? '',
    cancelled: o.cancelled ?? false,
    cancelledAt: o.cancelledAt,
    cancelledBy: o.cancelledBy,
  };
}

// Lee las líneas del log como objetos crudos (sin normalizar), para poder
// reescribir el fichero conservando el formato original de cada entrada.
function readRawLines(): Record<string, unknown>[] {
  if (!fs.existsSync(ORDERS_LOG_PATH)) return [];
  return fs.readFileSync(ORDERS_LOG_PATH, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map(l => {
      try { return JSON.parse(l) as Record<string, unknown>; } catch { return null; }
    })
    .filter((e): e is Record<string, unknown> => e !== null);
}

function readAllOrders(): PizzaOrderEntry[] {
  try {
    if (!fs.existsSync(ORDERS_LOG_PATH)) return [];
    return fs.readFileSync(ORDERS_LOG_PATH, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map(l => {
        try { return normalizeOrder(JSON.parse(l)); } catch { return null; }
      })
      .filter((e): e is PizzaOrderEntry => e !== null);
  } catch (err) {
    warn('PizzaService', `Error leyendo pedidos: ${(err as Error).message}`);
    return [];
  }
}

// Etiqueta legible de las líneas de un pedido, p.ej. "2x Menú Margarita, 1x Diavola"
export function itemsLabel(items: PizzaOrderItem[]): string {
  return items
    .map(it => `${it.cantidad}x ${it.tipo === 'menu' ? 'Menú ' : ''}${it.pizzaName}`)
    .join(', ');
}

function isUpcoming(dateStr: string, today: string): boolean {
  return ISO_DATE_RE.test(dateStr) && dateStr >= today;
}

// Suma `days` días a una fecha "YYYY-MM-DD" y devuelve el resultado en el mismo formato.
function addDaysIso(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y!, m! - 1, d!);
  date.setDate(date.getDate() + days);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Resumen de las reservas activas en los próximos `diasAdelante` días (por
// defecto 7), agrupadas por finde. Para ver TODAS las reservas futuras sin
// límite, usar getActiveUpcomingOrders().
export function buildPizzaOrdersSummary(diasAdelante = 7): string {
  const today = getTodayDate();
  const limite = addDaysIso(today, diasAdelante);
  const orders = readAllOrders().filter(o => !o.cancelled && isUpcoming(o.diaRecogida, today) && o.diaRecogida <= limite);

  if (orders.length === 0) {
    return `🍕 Pedidos de pizza (próximos ${diasAdelante} días)\n\nNo hay reservas activas en este rango.`;
  }

  const sorted = [...orders].sort((a, b) => {
    const diaDiff = a.diaRecogida.localeCompare(b.diaRecogida);
    if (diaDiff !== 0) return diaDiff;
    return a.horaRecogida.localeCompare(b.horaRecogida);
  });

  const porFinde = new Map<string, PizzaOrderEntry[]>();
  for (const o of sorted) {
    const key = o.weekOf || weekendKeyForPickedDate(o.diaRecogida);
    if (!porFinde.has(key)) porFinde.set(key, []);
    porFinde.get(key)!.push(o);
  }

  let text = `🍕 Pedidos de pizza — próximos ${diasAdelante} días\n\n`;
  let totalGeneral = 0;
  for (const [weekOf, group] of [...porFinde.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    text += `📅 Finde del ${formatPizzaDate(weekOf)}\n`;
    let totalFinde = 0;
    for (const o of group) {
      totalFinde += o.cantidadTotal;
      const ref = o.orderNumber ? `${o.orderNumber} · ` : '';
      text += `• ${ref}${formatPizzaDate(o.diaRecogida)} ${o.horaRecogida} — ${itemsLabel(o.items)} — ${o.nombre} (${o.telefono})\n`;
    }
    const restante = getRemainingStock(weekOf);
    text += `  Subtotal: ${totalFinde} ud(s)`;
    if (restante !== null) text += ` · Stock restante: ${restante}`;
    text += `\n\n`;
    totalGeneral += totalFinde;
  }
  text += `Total general: ${totalGeneral} unidad(es)`;

  return text.trim();
}

// ── Cancelación de reservas ───────────────────────────────────────────────────

// Reservas activas (no canceladas) de cualquier finde futuro.
export function getActiveUpcomingOrders(): PizzaOrderEntry[] {
  const today = getTodayDate();
  return readAllOrders().filter(o => !o.cancelled && isUpcoming(o.diaRecogida, today));
}

// Reservas activas próximas hechas por un usuario concreto.
export function getActiveOrdersByTelegramId(telegramId: string): PizzaOrderEntry[] {
  return getActiveUpcomingOrders().filter(o => o.telegramId === telegramId);
}

export function getOrderByNumber(orderNumber: string): PizzaOrderEntry | null {
  return readAllOrders().find(o => o.orderNumber === orderNumber) ?? null;
}

// Marca una reserva como cancelada (borrado lógico) y devuelve el stock a SU finde
// (el finde real de la reserva, no el que sea "ahora" — antes solo se devolvía si
// coincidía con el finde actual, lo cual era incorrecto para reservas futuras).
// Devuelve la reserva cancelada, o null si no existe o ya estaba cancelada.
export function cancelOrder(orderNumber: string, cancelledBy: string): PizzaOrderEntry | null {
  const raws = readRawLines();
  let cancelled: PizzaOrderEntry | null = null;

  for (const r of raws) {
    if (r['orderNumber'] === orderNumber && !r['cancelled']) {
      r['cancelled'] = true;
      r['cancelledAt'] = new Date().toISOString();
      r['cancelledBy'] = cancelledBy;
      cancelled = normalizeOrder(r);
      break;
    }
  }

  if (!cancelled) return null;

  fs.writeFileSync(ORDERS_LOG_PATH, raws.map(r => JSON.stringify(r)).join('\n') + '\n');

  restoreStock(cancelled.weekOf, cancelled.cantidadTotal);

  log('PizzaService', `Reserva ${orderNumber} cancelada por ${cancelledBy}`);
  return cancelled;
}
