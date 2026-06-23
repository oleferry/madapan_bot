import { Customer, HoldedOrder, HoldedLine, ValidationResult, ChangeLogEntry } from '../types';
import * as holdedClient from './holdedClient';
import * as clientCache from './clientCache';
import * as catalogService from './catalogService';
import { sendToAdmin, sendAlert } from './notifier';
import { logChange, log, warn } from '../utils/logger';
import { isAfterCutoff } from '../utils/dates';
import { config } from '../config';

// ── Customer registration ─────────────────────────────────────────────────────

export async function getOrRegisterCustomer(
  telegramId: string,
  nif?: string
): Promise<Customer | null> {
  const cached = clientCache.getClient(telegramId);
  if (cached) return cached;

  if (!nif) return null;

  const contact = await holdedClient.findContactByNif(nif);
  if (!contact) return null;

  // Buscar tarifa y descuento del cliente en el catálogo por NIF
  const catalogClient = contact.code ? catalogService.getClientByNif(contact.code) : null;

  const customer: Customer = {
    telegramId,
    holdedContactId: contact.id,
    name: contact.name,
    phone: contact.phone ?? '',
    tarifa: catalogClient?.tarifa ?? 'Tarifa 2025',
    discount: catalogClient?.discount ?? 20,
  };

  clientCache.saveClient(customer);
  log('OrderService', `Nuevo cliente registrado: ${customer.name} (${telegramId})`);

  if (!catalogClient) {
    sendToAdmin(
      `⚠️ Nuevo cliente registrado sin tarifa asignada:\n👤 ${customer.name}\nNIF: ${nif}\n\nAsígnale tarifa y descuento en el archivo catalog.json.`
    ).catch(() => {});
  } else {
    sendToAdmin(
      `✅ Nuevo cliente registrado:\n👤 ${customer.name}\nTarifa: ${customer.tarifa} — Dto: ${customer.discount}%`
    ).catch(() => {});
  }

  return customer;
}

// ── Order fetching ────────────────────────────────────────────────────────────

export async function getOrderForDate(
  customer: Customer,
  dateStr: string
): Promise<HoldedOrder | null> {
  return holdedClient.findOrderByContactAndDate(customer.holdedContactId, dateStr);
}

// ── Add product to order ──────────────────────────────────────────────────────

export async function addProductToOrder(
  customer: Customer,
  order: HoldedOrder,
  productCod: string,
  units: number
): Promise<{ success: boolean; message: string }> {
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

  const modoSeco = config.dryRun ? ' [SIMULADO]' : '';
  return {
    success: true,
    message: `✓ Añadido${modoSeco}: ${units} ${product.name} al pedido.`,
  };
}

// ── Thresholds ────────────────────────────────────────────────────────────────

export function getThreshold(lineName: string, afterCutoff: boolean): number {
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

export function validateDelta(
  line: HoldedLine,
  delta: number,
  afterCutoff: boolean
): ValidationResult {
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

export async function changeLineUnits(params: {
  customer: Customer;
  order: HoldedOrder;
  lineId: string;
  newUnits: number;
  source: 'button' | 'text';
}): Promise<{ success: boolean; message: string }> {
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
  const afterCutoff = isAfterCutoff();
  const threshold = getThreshold(line.name, afterCutoff);
  const overThreshold = Math.abs(delta) > threshold;

  // Apply the change regardless (warn if over threshold)
  const result = await holdedClient.updateLineUnits(order.id, lineId, newUnits, order);

  const entry: ChangeLogEntry = {
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
    dryRun: config.dryRun,
  };

  logChange(entry);

  if (!result.success) {
    warn('OrderService', `Failed to update line ${lineId}: ${result.error}`);
    return {
      success: false,
      message: 'Error al actualizar el pedido en Holded. Inténtalo de nuevo.',
    };
  }

  let message = `Pedido actualizado: ${line.name} ${previousUnits} → ${newUnits} uds.`;

  if (overThreshold) {
    message += `\n⚠️ Nota: el cambio supera el límite habitual (±${threshold}) y ha sido notificado internamente.`;
    log('OrderService', `Over-threshold change: ${customer.name}, ${line.name}, delta=${delta}, threshold=${threshold}`);
    const signo = delta > 0 ? '+' : '';
    sendAlert(
      `⚠️ Cambio fuera de límite:\n👤 ${customer.name}\n📦 ${line.name}: ${previousUnits} → ${newUnits} uds (${signo}${delta})\nLímite permitido: ±${threshold}`
    ).catch(() => {});
  }

  return { success: true, message };
}
