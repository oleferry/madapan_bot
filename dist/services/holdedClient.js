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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.findContactByNif = findContactByNif;
exports.listOrdersByContact = listOrdersByContact;
exports.getOrder = getOrder;
exports.findOrderByContactAndDate = findOrderByContactAndDate;
exports.isOrderEditable = isOrderEditable;
exports.updateLineUnits = updateLineUnits;
exports.removeLineFromOrder = removeLineFromOrder;
exports.listAllOrdersForDate = listAllOrdersForDate;
exports.addLineToOrder = addLineToOrder;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
const dates_1 = require("../utils/dates");
// ── Axios instances ──────────────────────────────────────────────────────────
let invoicingClient = null; // v2 — solo lectura
let invoicingV1Client = null; // v1 — escritura de líneas
let contactsClient = null;
const authHeaders = {
    'Authorization': `Bearer ${config_1.config.holdedApiKey}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
};
// v1 API usa header "key" con la clave legacy (no el PAT de v2)
const v1Headers = {
    'key': config_1.config.holdedApiKeyV1,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
};
function getInvoicingClient() {
    if (!invoicingClient) {
        invoicingClient = axios_1.default.create({
            baseURL: config_1.config.holdedApiBaseUrl,
            headers: authHeaders,
            timeout: 10000,
        });
    }
    return invoicingClient;
}
// v1 API — único que soporta actualizar líneas de documentos
function getInvoicingV1Client() {
    if (!invoicingV1Client) {
        invoicingV1Client = axios_1.default.create({
            baseURL: config_1.config.holdedApiV1Url,
            headers: v1Headers,
            timeout: 10000,
        });
    }
    return invoicingV1Client;
}
function getContactsClient() {
    if (!contactsClient) {
        contactsClient = axios_1.default.create({
            baseURL: config_1.config.holdedContactsUrl,
            headers: authHeaders,
            timeout: 10000,
        });
    }
    return contactsClient;
}
// ── Retry helper ─────────────────────────────────────────────────────────────
async function withRetry(fn, retries = 2, delayMs = 1500) {
    try {
        return await fn();
    }
    catch (err) {
        const axiosErr = err;
        const isTimeout = axiosErr.code === 'ECONNABORTED' || axiosErr.code === 'ETIMEDOUT';
        const isRateLimit = axiosErr.response?.status === 429;
        if ((isTimeout || isRateLimit) && retries > 0) {
            const wait = isRateLimit ? 3000 : delayMs;
            (0, logger_1.warn)('HoldedClient', `${isRateLimit ? 'Rate limit (429)' : 'Timeout'} — reintentando en ${wait}ms...`);
            await new Promise(r => setTimeout(r, wait));
            return withRetry(fn, retries - 1, delayMs);
        }
        throw err;
    }
}
// ── Contacts API ──────────────────────────────────────────────────────────────
async function findContactByNif(nif) {
    const needle = nif.trim().toUpperCase().replace(/[\s\-]/g, '');
    try {
        // Una sola llamada con límite alto — Madapan tiene ~30 clientes activos
        const response = await withRetry(() => getContactsClient().get('/contacts', {
            params: { type: 'client', limit: 500 },
        }));
        const items = Array.isArray(response.data)
            ? response.data
            : Array.isArray(response.data?.items)
                ? response.data.items
                : [];
        const found = items.find((c) => {
            const code = String(c.code ?? '').toUpperCase().replace(/[\s\-]/g, '');
            const vatNumber = String(c.vat_number ?? '').toUpperCase().replace(/[\s\-]/g, '');
            return code === needle || vatNumber === needle;
        });
        if (found) {
            (0, logger_1.log)('HoldedClient', `Contacto encontrado: ${found.name} (${found.id})`);
        }
        else {
            (0, logger_1.warn)('HoldedClient', `NIF ${needle} no encontrado entre ${items.length} clientes de Holded`);
        }
        return found ?? null;
    }
    catch (err) {
        (0, logger_1.error)('HoldedClient', `findContactByNif failed: ${err.message}`);
        return null;
    }
}
// ── Sales Orders API ──────────────────────────────────────────────────────────
// Holded devuelve números como texto en formato español: "1.234,56" → 1234.56
function parseEsNumber(value) {
    if (typeof value === 'number')
        return value;
    if (!value)
        return 0;
    const normalized = String(value).replace(/\./g, '').replace(',', '.');
    const n = parseFloat(normalized);
    return isNaN(n) ? 0 : n;
}
// Mapea un pedido crudo de Holded a nuestra estructura HoldedOrder
function mapOrder(raw) {
    const rawLines = Array.isArray(raw.lines) ? raw.lines : [];
    const lines = rawLines.map((l, idx) => ({
        id: l.line_id ?? l.id ?? `line_${idx}`,
        productId: l.product_id ?? '',
        variantId: l.variant_id ?? '',
        sku: l.sku ?? '',
        name: l.name ?? '',
        units: Math.round(parseEsNumber(l.units)),
        price: parseEsNumber(l.price),
        rawPrice: String(l.price ?? '0'),
        rawDiscount: String(l.discount ?? '0'),
        discount: parseEsNumber(l.discount),
        taxes: Array.isArray(l.taxes) ? l.taxes : [],
        _raw: l,
    }));
    return {
        id: raw.id,
        contactId: raw.contact_id ?? '',
        contactName: raw.contact_name ?? '',
        date: raw.date, // texto "YYYY-MM-DD"
        status: raw.status, // texto: "pending", "approved", "invoiced", ...
        lines,
        notes: raw.notes ?? '',
    };
}
async function listOrdersByContact(contactId) {
    try {
        (0, logger_1.log)('HoldedClient', `listOrdersByContact(${contactId})...`);
        const response = await withRetry(() => getInvoicingClient().get('/sales-orders', {
            params: { contact_id: contactId },
        }));
        const list = Array.isArray(response.data)
            ? response.data
            : Array.isArray(response.data?.items)
                ? response.data.items
                : [];
        (0, logger_1.log)('HoldedClient', `listOrdersByContact: ${list.length} pedidos encontrados`);
        if (list.length > 0)
            (0, logger_1.log)('HoldedClient', `Primer pedido: id=${list[0].id} date=${list[0].date}`);
        return list;
    }
    catch (err) {
        (0, logger_1.error)('HoldedClient', `listOrdersByContact failed: ${err.message}`);
        return [];
    }
}
async function getOrder(orderId) {
    try {
        const response = await withRetry(() => getInvoicingClient().get(`/sales-orders/${orderId}`));
        const raw = response.data?.data ?? response.data;
        if (!raw || !raw.id)
            return null;
        (0, logger_1.log)('HoldedClient', `getOrder(${orderId}): status=${raw.status}, lines=${raw.lines?.length ?? 0}`);
        return mapOrder(raw);
    }
    catch (err) {
        (0, logger_1.error)('HoldedClient', `getOrder(${orderId}) failed: ${err.message}`);
        return null;
    }
}
async function findOrderByContactAndDate(contactId, dateStr) {
    const orders = await listOrdersByContact(contactId);
    const match = orders.find((o) => {
        if (!o.date)
            return false;
        const orderDate = typeof o.date === 'number'
            ? (0, dates_1.unixToDateStr)(o.date)
            : String(o.date).split('T')[0];
        return orderDate === dateStr;
    });
    (0, logger_1.log)('HoldedClient', `findOrderByContactAndDate: buscando fecha ${dateStr} entre ${orders.length} pedidos`);
    if (!match) {
        if (orders.length > 0)
            (0, logger_1.log)('HoldedClient', `Fechas disponibles: ${orders.map((o) => o.date).join(', ')}`);
        return null;
    }
    // Cargar el pedido completo con líneas
    return getOrder(match.id);
}
function isOrderEditable(order) {
    const status = String(order.status ?? '').toLowerCase();
    // No editable si está facturado o cancelado
    return status !== 'invoiced' && status !== 'cancelled' && status !== 'canceled';
}
async function updateLineUnits(orderId, lineId, newUnits, order) {
    if (config_1.isDryRun) {
        (0, logger_1.log)('HoldedClient', `[DRY_RUN] Would update order ${orderId}, line ${lineId} → ${newUnits} units`);
        return { success: true, orderId, lineId, newUnits };
    }
    try {
        // v1 API: PUT /documents/salesorder/{id} con key "items"
        // Verificado: "items" actualiza líneas; "products" lo ignora
        const items = order.lines.map((line) => ({
            productId: line.productId,
            variantId: line.variantId,
            units: line.id === lineId ? newUnits : line.units,
            price: line.price,
            discount: line.discount,
            taxes: line.taxes,
            name: line.name,
            sku: line.sku,
        }));
        const body = { items };
        (0, logger_1.log)('HoldedClient', `PUT v1/documents/salesorder/${orderId}: items=${JSON.stringify(items.map(i => ({ sku: i.sku, units: i.units })))}`);
        const response = await withRetry(() => getInvoicingV1Client().put(`/documents/salesorder/${orderId}`, body));
        (0, logger_1.log)('HoldedClient', `PUT v1 response: ${JSON.stringify(response.data)}`);
        (0, logger_1.log)('HoldedClient', `Updated order ${orderId}, line ${lineId} → ${newUnits} units`);
        return { success: true, orderId, lineId, newUnits };
    }
    catch (err) {
        const axErr = err;
        const respBody = axErr.response?.data;
        (0, logger_1.error)('HoldedClient', `updateLineUnits failed: ${axErr.message} | Response: ${JSON.stringify(respBody)}`);
        return { success: false, orderId, lineId, newUnits, error: axErr.message };
    }
}
async function removeLineFromOrder(orderId, lineId, order) {
    if (config_1.isDryRun) {
        (0, logger_1.log)('HoldedClient', `[DRY_RUN] Would remove line ${lineId} from order ${orderId}`);
        return { success: true };
    }
    try {
        const items = order.lines
            .filter((line) => line.id !== lineId)
            .map((line) => ({
            productId: line.productId,
            variantId: line.variantId,
            units: line.units,
            price: line.price,
            discount: line.discount,
            taxes: line.taxes,
            name: line.name,
            sku: line.sku,
        }));
        await withRetry(() => getInvoicingV1Client().put(`/documents/salesorder/${orderId}`, { items }));
        (0, logger_1.log)('HoldedClient', `Removed line ${lineId} from order ${orderId}`);
        return { success: true };
    }
    catch (err) {
        const msg = err.message;
        (0, logger_1.error)('HoldedClient', `removeLineFromOrder failed: ${msg}`);
        return { success: false, error: msg };
    }
}
async function listAllOrdersForDate(dateStr) {
    try {
        (0, logger_1.log)('HoldedClient', `listAllOrdersForDate(${dateStr})...`);
        const { dateStrToUnix } = await Promise.resolve().then(() => __importStar(require('../utils/dates')));
        const startTs = dateStrToUnix(dateStr);
        const endTs = startTs + 86399; // fin del día
        const response = await withRetry(() => getInvoicingClient().get('/sales-orders', {
            params: { startDate: startTs, endDate: endTs, limit: 500 },
        }));
        const list = Array.isArray(response.data)
            ? response.data
            : Array.isArray(response.data?.items)
                ? response.data.items
                : [];
        // Filtrar también por fecha en local por si Holded no filtra bien
        const orders = [];
        for (const item of list) {
            const itemDate = typeof item.date === 'number'
                ? (0, dates_1.unixToDateStr)(item.date)
                : String(item.date ?? '').split('T')[0];
            if (itemDate !== dateStr)
                continue;
            const full = await getOrder(item.id);
            if (full)
                orders.push(full);
        }
        (0, logger_1.log)('HoldedClient', `listAllOrdersForDate(${dateStr}): ${orders.length} pedidos`);
        return orders;
    }
    catch (err) {
        (0, logger_1.error)('HoldedClient', `listAllOrdersForDate failed: ${err.message}`);
        return [];
    }
}
async function addLineToOrder(orderId, order, newLine) {
    const taxKey = `s_iva_${newLine.taxPct}`;
    if (config_1.isDryRun) {
        (0, logger_1.log)('HoldedClient', `[DRY_RUN] Would add line to order ${orderId}: ${newLine.units}x ${newLine.name} @ ${newLine.price} (${newLine.discount}% dto)`);
        return { success: true };
    }
    try {
        const existingItems = order.lines.map((line) => ({
            productId: line.productId,
            variantId: line.variantId,
            units: line.units,
            price: line.price,
            discount: line.discount,
            taxes: line.taxes,
            sku: line.sku,
            name: line.name,
        }));
        const newItem = {
            productId: newLine.productId,
            units: newLine.units,
            price: newLine.price,
            discount: newLine.discount,
            taxes: [taxKey],
            sku: newLine.sku,
            name: newLine.name,
        };
        await withRetry(() => getInvoicingV1Client().put(`/documents/salesorder/${orderId}`, {
            items: [...existingItems, newItem],
        }));
        (0, logger_1.log)('HoldedClient', `Added line to order ${orderId}: ${newLine.units}x ${newLine.name}`);
        return { success: true };
    }
    catch (err) {
        const msg = err.message;
        (0, logger_1.error)('HoldedClient', `addLineToOrder failed: ${msg}`);
        return { success: false, error: msg };
    }
}
//# sourceMappingURL=holdedClient.js.map