"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMenu = getMenu;
exports.getPizzaById = getPizzaById;
exports.getPostreById = getPostreById;
exports.setWeekendStock = setWeekendStock;
exports.getRemainingStock = getRemainingStock;
exports.consumeStock = consumeStock;
exports.logPizzaOrder = logPizzaOrder;
exports.buildPizzaOrdersSummary = buildPizzaOrdersSummary;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const logger_1 = require("../utils/logger");
let menu = null;
function getMenu() {
    if (menu)
        return menu;
    const filePath = path.resolve('data/pizza-menu.json');
    menu = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return menu;
}
function getPizzaById(id) {
    return getMenu().pizzas.find(p => p.id === id) ?? null;
}
function getPostreById(id) {
    return getMenu().postres.find(p => p.id === id) ?? null;
}
const STOCK_PATH = path.resolve('data/pizza-stock.json');
function loadStock() {
    try {
        if (!fs.existsSync(STOCK_PATH)) {
            return { weekOf: '', totalDisponible: 0, usadas: 0 };
        }
        return JSON.parse(fs.readFileSync(STOCK_PATH, 'utf-8'));
    }
    catch (err) {
        (0, logger_1.warn)('PizzaService', `Error leyendo stock: ${err.message}`);
        return { weekOf: '', totalDisponible: 0, usadas: 0 };
    }
}
function saveStock(state) {
    fs.mkdirSync(path.dirname(STOCK_PATH), { recursive: true });
    fs.writeFileSync(STOCK_PATH, JSON.stringify(state, null, 2));
}
// Devuelve el viernes de la semana en curso (o el próximo si hoy es antes) como "YYYY-MM-DD"
function currentWeekendKey() {
    const now = new Date();
    const dow = now.getDay(); // 0=Dom...6=Sáb
    // Días hasta el viernes más próximo hacia atrás (si ya pasó el finde, key es el viernes que viene)
    let diffToFriday = 5 - dow;
    if (diffToFriday < -1)
        diffToFriday += 7; // si ya es domingo pasado el viernes, saltar a siguiente semana
    const friday = new Date(now);
    friday.setDate(now.getDate() + diffToFriday);
    return friday.toISOString().slice(0, 10);
}
// Admin: fija el total de bases disponibles para el finde en curso
function setWeekendStock(total) {
    const state = { weekOf: currentWeekendKey(), totalDisponible: total, usadas: 0 };
    saveStock(state);
    (0, logger_1.log)('PizzaService', `Stock de pizzas fijado a ${total} para el finde del ${state.weekOf}`);
}
function getRemainingStock() {
    const state = loadStock();
    if (state.weekOf !== currentWeekendKey())
        return null; // sin stock configurado esta semana
    return Math.max(0, state.totalDisponible - state.usadas);
}
// Descuenta unidades del stock; devuelve false si no hay suficiente
function consumeStock(units) {
    const state = loadStock();
    if (state.weekOf !== currentWeekendKey())
        return true; // sin control de stock configurado — se permite
    const restante = state.totalDisponible - state.usadas;
    if (restante < units)
        return false;
    state.usadas += units;
    saveStock(state);
    return true;
}
const ORDERS_LOG_PATH = path.resolve('logs/pizza-orders.log');
function logPizzaOrder(entry) {
    fs.mkdirSync(path.dirname(ORDERS_LOG_PATH), { recursive: true });
    const full = { ...entry, weekOf: currentWeekendKey() };
    fs.appendFileSync(ORDERS_LOG_PATH, JSON.stringify(full) + '\n');
}
function readAllOrders() {
    try {
        if (!fs.existsSync(ORDERS_LOG_PATH))
            return [];
        return fs.readFileSync(ORDERS_LOG_PATH, 'utf-8')
            .split('\n')
            .filter(Boolean)
            .map(l => {
            try {
                return JSON.parse(l);
            }
            catch {
                return null;
            }
        })
            .filter((e) => e !== null);
    }
    catch (err) {
        (0, logger_1.warn)('PizzaService', `Error leyendo pedidos: ${err.message}`);
        return [];
    }
}
const DIA_ORDEN = { 'Viernes': 0, 'Sábado': 1, 'Domingo': 2 };
// Resumen de las reservas del finde en curso: tipo, día, hora y cliente
function buildPizzaOrdersSummary() {
    const weekOf = currentWeekendKey();
    const orders = readAllOrders().filter(o => o.weekOf === weekOf);
    if (orders.length === 0) {
        return `🍕 Pedidos de pizza — finde del ${weekOf}\n\nNo hay reservas todavía.`;
    }
    const sorted = [...orders].sort((a, b) => {
        const diaDiff = (DIA_ORDEN[a.diaRecogida] ?? 9) - (DIA_ORDEN[b.diaRecogida] ?? 9);
        if (diaDiff !== 0)
            return diaDiff;
        return a.horaRecogida.localeCompare(b.horaRecogida);
    });
    let totalUnidades = 0;
    let text = `🍕 Pedidos de pizza — finde del ${weekOf}\n${orders.length} reserva(s)\n\n`;
    for (const o of sorted) {
        totalUnidades += o.cantidad;
        const tipoLabel = o.tipo === 'menu' ? 'Menú' : 'Individual';
        text += `• ${o.diaRecogida} ${o.horaRecogida} — ${o.cantidad}x ${tipoLabel} ${o.pizzaName} — ${o.nombre} (${o.telefono})\n`;
    }
    text += `\nTotal unidades reservadas: ${totalUnidades}`;
    const restante = getRemainingStock();
    if (restante !== null)
        text += `\nStock restante: ${restante}`;
    return text;
}
//# sourceMappingURL=pizzaService.js.map