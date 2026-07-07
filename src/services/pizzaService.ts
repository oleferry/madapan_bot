import * as fs from 'fs';
import * as path from 'path';
import { log, warn } from '../utils/logger';

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

// ── Stock semanal (local, no tracked — se resetea cada semana) ──────────────

interface PizzaStockState {
  weekOf: string; // fecha del viernes de la semana en curso, "YYYY-MM-DD"
  totalDisponible: number; // unidades de "base" preparadas para el finde
  usadas: number;
}

const STOCK_PATH = path.resolve('data/pizza-stock.json');

function loadStock(): PizzaStockState {
  try {
    if (!fs.existsSync(STOCK_PATH)) {
      return { weekOf: '', totalDisponible: 0, usadas: 0 };
    }
    return JSON.parse(fs.readFileSync(STOCK_PATH, 'utf-8'));
  } catch (err) {
    warn('PizzaService', `Error leyendo stock: ${(err as Error).message}`);
    return { weekOf: '', totalDisponible: 0, usadas: 0 };
  }
}

function saveStock(state: PizzaStockState): void {
  fs.mkdirSync(path.dirname(STOCK_PATH), { recursive: true });
  fs.writeFileSync(STOCK_PATH, JSON.stringify(state, null, 2));
}

// Devuelve el viernes de la semana en curso (o el próximo si hoy es antes) como "YYYY-MM-DD"
function currentWeekendKey(): string {
  const now = new Date();
  const dow = now.getDay(); // 0=Dom...6=Sáb
  // Días hasta el viernes más próximo hacia atrás (si ya pasó el finde, key es el viernes que viene)
  let diffToFriday = 5 - dow;
  if (diffToFriday < -1) diffToFriday += 7; // si ya es domingo pasado el viernes, saltar a siguiente semana
  const friday = new Date(now);
  friday.setDate(now.getDate() + diffToFriday);
  return friday.toISOString().slice(0, 10);
}

// Admin: fija el total de bases disponibles para el finde en curso
export function setWeekendStock(total: number): void {
  const state: PizzaStockState = { weekOf: currentWeekendKey(), totalDisponible: total, usadas: 0 };
  saveStock(state);
  log('PizzaService', `Stock de pizzas fijado a ${total} para el finde del ${state.weekOf}`);
}

export function getRemainingStock(): number | null {
  const state = loadStock();
  if (state.weekOf !== currentWeekendKey()) return null; // sin stock configurado esta semana
  return Math.max(0, state.totalDisponible - state.usadas);
}

// Descuenta unidades del stock; devuelve false si no hay suficiente
export function consumeStock(units: number): boolean {
  const state = loadStock();
  if (state.weekOf !== currentWeekendKey()) return true; // sin control de stock configurado — se permite

  const restante = state.totalDisponible - state.usadas;
  if (restante < units) return false;

  state.usadas += units;
  saveStock(state);
  return true;
}

// ── Log de pedidos de pizza ───────────────────────────────────────────────────

export interface PizzaOrderEntry {
  timestamp: string;
  telegramId: string;
  nombre: string;
  telefono: string;
  email: string;
  tipo: 'individual' | 'menu';
  pizzaId: string;
  pizzaName: string;
  postres: string[];
  cantidad: number;
  diaRecogida: string;
  horaRecogida: string;
  precioTotal: number;
}

const ORDERS_LOG_PATH = path.resolve('logs/pizza-orders.log');

export function logPizzaOrder(entry: PizzaOrderEntry): void {
  fs.mkdirSync(path.dirname(ORDERS_LOG_PATH), { recursive: true });
  fs.appendFileSync(ORDERS_LOG_PATH, JSON.stringify(entry) + '\n');
}
