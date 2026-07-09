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
exports.getClientByNif = getClientByNif;
exports.getAllProducts = getAllProducts;
exports.getAllClients = getAllClients;
exports.getProductByCod = getProductByCod;
exports.getProductBySku = getProductBySku;
exports.getClientPrice = getClientPrice;
exports.getTarifaPrice = getTarifaPrice;
exports.getAvailableProducts = getAvailableProducts;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
let catalog = null;
function load() {
    if (catalog)
        return catalog;
    const filePath = path.resolve('data/catalog.json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    catalog = JSON.parse(raw);
    return catalog;
}
function getClientByNif(nif) {
    const c = load();
    const key = nif.trim().toUpperCase().replace(/[\s\-]/g, '');
    return c.clients[key] ?? null;
}
function getAllProducts() {
    return load().products;
}
// Lista de clientes (NIF + nombre) ordenada alfabéticamente — para el menú de admin
function getAllClients() {
    const c = load();
    return Object.entries(c.clients)
        .map(([nif, client]) => ({ nif, name: client.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
}
function getProductByCod(cod) {
    return load().products.find(p => p.cod === cod) ?? null;
}
function getProductBySku(sku) {
    return load().products.find(p => p.sku === sku) ?? null;
}
// Calcula el precio neto para un cliente (con su tarifa y descuento)
function getClientPrice(product, tarifa, discountPct) {
    const base = product.prices[tarifa] ?? product.prices['Tarifa 2025'] ?? 0;
    return Math.round(base * (1 - discountPct / 100) * 100000) / 100000;
}
// Devuelve solo el precio base de tarifa (sin descuento — Holded aplica el descuento por separado)
function getTarifaPrice(product, tarifa) {
    return product.prices[tarifa] ?? product.prices['Tarifa 2025'] ?? 0;
}
// Productos disponibles para añadir (los que tienen holdedId)
function getAvailableProducts() {
    return load().products.filter(p => p.holdedId !== null);
}
//# sourceMappingURL=catalogService.js.map