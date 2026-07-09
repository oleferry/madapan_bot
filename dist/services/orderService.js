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
exports.getOrRegisterCustomer = getOrRegisterCustomer;
exports.getOrderForDate = getOrderForDate;
exports.addProductToOrder = addProductToOrder;
exports.getThreshold = getThreshold;
exports.validateDelta = validateDelta;
exports.changeLineUnits = changeLineUnits;
const holdedClient = __importStar(require("./holdedClient"));
const clientCache = __importStar(require("./clientCache"));
const catalogService = __importStar(require("./catalogService"));
const notifier_1 = require("./notifier");
const logger_1 = require("../utils/logger");
const dates_1 = require("../utils/dates");
const config_1 = require("../config");
// ── Customer registration ─────────────────────────────────────────────────────
async function getOrRegisterCustomer(telegramId, nif) {
    const cached = clientCache.getClient(telegramId);
    if (cached)
        return cached;
    if (!nif)
        return null;
    const contact = await holdedClient.findContactByNif(nif);
    if (!contact)
        return null;
    // Buscar tarifa y descuento del cliente en el catálogo por NIF
    const catalogClient = contact.code ? catalogService.getClientByNif(contact.code) : null;
    const customer = {
        telegramId,
        holdedContactId: contact.id,
        name: contact.name,
        phone: contact.phone ?? '',
        tarifa: catalogClient?.tarifa ?? 'Tarifa 2025',
        discount: catalogClient?.discount ?? 20,
    };
    clientCache.saveClient(customer);
    (0, logger_1.log)('OrderService', `Nuevo cliente registrado: ${customer.name} (${telegramId})`);
    if (!catalogClient) {
        (0, notifier_1.sendToAdmin)(`⚠️ Nuevo cliente registrado sin tarifa asignada:\n👤 ${customer.name}\nNIF: ${nif}\n\nAsígnale tarifa y descuento en el archivo catalog.json.`).catch(() => { });
    }
    else {
        (0, notifier_1.sendToAdmin)(`✅ Nuevo cliente registrado:\n👤 ${customer.name}\nTarifa: ${customer.tarifa} — Dto: ${customer.discount}%`).catch(() => { });
    }
    return customer;
}
// ── Order fetching ────────────────────────────────────────────────────────────
async function getOrderForDate(customer, dateStr) {
    return holdedClient.findOrderByContactAndDate(customer.holdedContactId, dateStr);
}
// ── Add product to order ──────────────────────────────────────────────────────
async function addProductToOrder(customer, order, productCod, units) {
    const product = catalogService.getProductByCod(productCod);
    if (!product || !product.holdedId) {
        return { success: false, message: 'Producto no disponible.' };
    }
    // Comprobar que no está ya en el pedido
    const alreadyInOrder = order.lines.some(l => l.sku === product.sku);
    if (alreadyInOrder) {
        return { success: false, message: `${product.name} ya está en el pedido. Usa los botones para cambiar la cantidad.` };
    }
    const tarifa = customer.tarifa ?? 'Tarifa 2025';
    const discount = customer.discount ?? 20;
    const price = catalogService.getTarifaPrice(product, tarifa);
    const result = await holdedClient.addLineToOrder(order.id, order, {
        productId: product.holdedId,
        name: product.name,
        sku: product.sku,
        units,
        price,
        discount,
        taxPct: product.iva,
    });
    if (!result.success) {
        return { success: false, message: 'Error al añadir el producto. Inténtalo de nuevo.' };
    }
    const modoSeco = config_1.config.dryRun ? ' [SIMULADO]' : '';
    return {
        success: true,
        message: `✓ Añadido${modoSeco}: ${units} ${product.name} al pedido.`,
    };
}
// ── Thresholds ────────────────────────────────────────────────────────────────
function getThreshold(lineName, afterCutoff) {
    const name = lineName.toLowerCase();
    if (name.includes('barra') && !name.includes('pequeñ')) {
        return afterCutoff ? 3 : 10;
    }
    if (name.includes('chapata')) {
        return afterCutoff ? 2 : 6;
    }
    if (name.includes('hogaza') || name.includes('hogaza')) {
        return afterCutoff ? 2 : 5;
    }
    if (name.includes('centeno') || name.includes('semillas')) {
        return afterCutoff ? 1 : 4;
    }
    if (name.includes('molde') || name.includes('integral')) {
        return afterCutoff ? 2 : 6;
    }
    // Default
    return afterCutoff ? 2 : 5;
}
// ── Validation ────────────────────────────────────────────────────────────────
function validateDelta(line, delta, afterCutoff) {
    const newUnits = line.units + delta;
    if (newUnits < 0) {
        return { valid: false, reason: 'La cantidad no puede ser negativa.' };
    }
    const threshold = getThreshold(line.name, afterCutoff);
    if (Math.abs(delta) > threshold) {
        return {
            valid: false,
            reason: `El cambio de ${delta > 0 ? '+' : ''}${delta} supera el límite permitido (±${threshold}) para este horario.`,
        };
    }
    return { valid: true };
}
// ── Apply change ──────────────────────────────────────────────────────────────
async function changeLineUnits(params) {
    const { customer, order, lineId, newUnits, source } = params;
    if (newUnits < 0) {
        return { success: false, message: 'La cantidad no puede ser negativa.' };
    }
    if (!holdedClient.isOrderEditable(order)) {
        return { success: false, message: 'Este pedido ya está facturado y no se puede modificar.' };
    }
    const line = order.lines.find((l) => l.id === lineId);
    if (!line) {
        return { success: false, message: 'Línea de pedido no encontrada.' };
    }
    const previousUnits = line.units;
    const delta = newUnits - previousUnits;
    const afterCutoff = (0, dates_1.isAfterCutoff)();
    const threshold = getThreshold(line.name, afterCutoff);
    const overThreshold = Math.abs(delta) > threshold;
    // Apply the change regardless (warn if over threshold)
    const result = await holdedClient.updateLineUnits(order.id, lineId, newUnits, order);
    const entry = {
        timestamp: new Date().toISOString(),
        telegramId: customer.telegramId,
        customerName: customer.name,
        orderId: order.id,
        lineId,
        productName: line.name,
        sku: line.sku,
        previousUnits,
        newUnits,
        delta,
        source,
        dryRun: config_1.config.dryRun,
    };
    (0, logger_1.logChange)(entry);
    if (!result.success) {
        (0, logger_1.warn)('OrderService', `Failed to update line ${lineId}: ${result.error}`);
        return {
            success: false,
            message: 'Error al actualizar el pedido en Holded. Inténtalo de nuevo.',
        };
    }
    let message = `Pedido actualizado: ${line.name} ${previousUnits} → ${newUnits} uds.`;
    if (overThreshold) {
        message += `\n⚠️ Nota: el cambio supera el límite habitual (±${threshold}) y ha sido notificado internamente.`;
        (0, logger_1.log)('OrderService', `Over-threshold change: ${customer.name}, ${line.name}, delta=${delta}, threshold=${threshold}`);
        const signo = delta > 0 ? '+' : '';
        (0, notifier_1.sendAlert)(`⚠️ Cambio fuera de límite:\n👤 ${customer.name}\n📦 ${line.name}: ${previousUnits} → ${newUnits} uds (${signo}${delta})\nLímite permitido: ±${threshold}`).catch(() => { });
    }
    return { success: true, message };
}
//# sourceMappingURL=orderService.js.map