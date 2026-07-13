import axios, { AxiosInstance, AxiosError } from 'axios';
import { config, isDryRun } from '../config';
import { HoldedContact, HoldedOrder, HoldedLine, HoldedUpdateResult } from '../types';
import { log, warn, error } from '../utils/logger';
import { unixToDateStr } from '../utils/dates';

// ── Axios instances ──────────────────────────────────────────────────────────

let invoicingClient: AxiosInstance | null = null;  // v2 — solo lectura
let invoicingV1Client: AxiosInstance | null = null; // v1 — escritura de líneas
let contactsClient: AxiosInstance | null = null;

const authHeaders = {
  'Authorization': `Bearer ${config.holdedApiKey}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
};

// v1 API usa header "key" con la clave legacy (no el PAT de v2)
const v1Headers = {
  'key': config.holdedApiKeyV1,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
};

function getInvoicingClient(): AxiosInstance {
  if (!invoicingClient) {
    invoicingClient = axios.create({
      baseURL: config.holdedApiBaseUrl,
      headers: authHeaders,
      timeout: 10000,
    });
  }
  return invoicingClient;
}

// v1 API — único que soporta actualizar líneas de documentos
function getInvoicingV1Client(): AxiosInstance {
  if (!invoicingV1Client) {
    invoicingV1Client = axios.create({
      baseURL: config.holdedApiV1Url,
      headers: v1Headers,
      timeout: 10000,
    });
  }
  return invoicingV1Client;
}

function getContactsClient(): AxiosInstance {
  if (!contactsClient) {
    contactsClient = axios.create({
      baseURL: config.holdedContactsUrl,
      headers: authHeaders,
      timeout: 10000,
    });
  }
  return contactsClient;
}

// ── Retry helper ─────────────────────────────────────────────────────────────

async function withRetry<T>(fn: () => Promise<T>, retries = 2, delayMs = 1500): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const axiosErr = err as AxiosError;
    const isTimeout = axiosErr.code === 'ECONNABORTED' || axiosErr.code === 'ETIMEDOUT';
    const isRateLimit = axiosErr.response?.status === 429;
    if ((isTimeout || isRateLimit) && retries > 0) {
      const wait = isRateLimit ? 3000 : delayMs;
      warn('HoldedClient', `${isRateLimit ? 'Rate limit (429)' : 'Timeout'} — reintentando en ${wait}ms...`);
      await new Promise(r => setTimeout(r, wait));
      return withRetry(fn, retries - 1, delayMs);
    }
    throw err;
  }
}

// ── Contacts API ──────────────────────────────────────────────────────────────

export async function findContactByNif(nif: string): Promise<HoldedContact | null> {
  const needle = nif.trim().toUpperCase().replace(/[\s\-]/g, '');

  try {
    // Una sola llamada con límite alto — Madapan tiene ~30 clientes activos
    const response = await withRetry(() =>
      getContactsClient().get<any>('/contacts', {
        params: { type: 'client', limit: 500 },
      })
    );

    const items: any[] = Array.isArray(response.data)
      ? response.data
      : Array.isArray(response.data?.items)
        ? response.data.items
        : [];

    const found = items.find((c: any) => {
      const code = String(c.code ?? '').toUpperCase().replace(/[\s\-]/g, '');
      const vatNumber = String(c.vat_number ?? '').toUpperCase().replace(/[\s\-]/g, '');
      return code === needle || vatNumber === needle;
    });

    if (found) {
      log('HoldedClient', `Contacto encontrado: ${found.name} (${found.id})`);
    } else {
      warn('HoldedClient', `NIF ${needle} no encontrado entre ${items.length} clientes de Holded`);
    }

    return found ?? null;
  } catch (err) {
    error('HoldedClient', `findContactByNif failed: ${(err as Error).message}`);
    return null;
  }
}

// ── Sales Orders API ──────────────────────────────────────────────────────────

// Holded devuelve números como texto en formato español: "1.234,56" → 1234.56
function parseEsNumber(value: any): number {
  if (typeof value === 'number') return value;
  if (!value) return 0;
  const normalized = String(value).replace(/\./g, '').replace(',', '.');
  const n = parseFloat(normalized);
  return isNaN(n) ? 0 : n;
}

// Mapea un pedido crudo de Holded a nuestra estructura HoldedOrder
function mapOrder(raw: any): HoldedOrder {
  const rawLines = Array.isArray(raw.lines) ? raw.lines : [];
  const lines: HoldedLine[] = rawLines.map((l: any, idx: number) => ({
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
    docNumber: raw.docNumber ?? raw.doc_number ?? undefined,
    contactId: raw.contact_id ?? '',
    contactName: raw.contact_name ?? '',
    date: raw.date, // texto "YYYY-MM-DD"
    status: raw.status, // texto: "pending", "approved", "invoiced", ...
    lines,
    notes: raw.notes ?? '',
  };
}

export async function listOrdersByContact(contactId: string): Promise<any[]> {
  try {
    log('HoldedClient', `listOrdersByContact(${contactId})...`);
    const response = await withRetry(() =>
      getInvoicingClient().get<any>('/sales-orders', {
        params: { contact_id: contactId },
      })
    );
    const list = Array.isArray(response.data)
      ? response.data
      : Array.isArray(response.data?.items)
        ? response.data.items
        : [];
    log('HoldedClient', `listOrdersByContact: ${list.length} pedidos encontrados`);
    if (list.length > 0) log('HoldedClient', `Primer pedido: id=${list[0].id} date=${list[0].date}`);
    return list;
  } catch (err) {
    error('HoldedClient', `listOrdersByContact failed: ${(err as Error).message}`);
    return [];
  }
}

export async function getOrder(orderId: string): Promise<HoldedOrder | null> {
  try {
    const response = await withRetry(() =>
      getInvoicingClient().get<any>(`/sales-orders/${orderId}`)
    );
    const raw = response.data?.data ?? response.data;
    if (!raw || !raw.id) return null;
    log('HoldedClient', `getOrder(${orderId}): status=${raw.status}, lines=${raw.lines?.length ?? 0}`);
    return mapOrder(raw);
  } catch (err) {
    error('HoldedClient', `getOrder(${orderId}) failed: ${(err as Error).message}`);
    return null;
  }
}

export async function findOrderByContactAndDate(
  contactId: string,
  dateStr: string
): Promise<HoldedOrder | null> {
  const orders = await listOrdersByContact(contactId);

  const match = orders.find((o) => {
    if (!o.date) return false;
    const orderDate =
      typeof o.date === 'number'
        ? unixToDateStr(o.date)
        : String(o.date).split('T')[0]!;
    return orderDate === dateStr;
  });

  log('HoldedClient', `findOrderByContactAndDate: buscando fecha ${dateStr} entre ${orders.length} pedidos`);
  if (!match) {
    if (orders.length > 0) log('HoldedClient', `Fechas disponibles: ${orders.map((o: any) => o.date).join(', ')}`);
    return null;
  }

  // Cargar el pedido completo con líneas
  return getOrder(match.id);
}

export function isOrderEditable(order: HoldedOrder): boolean {
  const status = String(order.status ?? '').toLowerCase();
  // No editable si está facturado o cancelado
  return status !== 'invoiced' && status !== 'cancelled' && status !== 'canceled';
}

export async function updateLineUnits(
  orderId: string,
  lineId: string,
  newUnits: number,
  order: HoldedOrder
): Promise<HoldedUpdateResult> {
  if (isDryRun) {
    log(
      'HoldedClient',
      `[DRY_RUN] Would update order ${orderId}, line ${lineId} → ${newUnits} units`
    );
    return { success: true, orderId, lineId, newUnits };
  }

  try {
    // v1 API: PUT /documents/salesorder/{id} con key "items"
    // Verificado: "items" actualiza líneas; "products" lo ignora
    const items = order.lines.map((line: HoldedLine) => ({
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

    log('HoldedClient', `PUT v1/documents/salesorder/${orderId}: items=${JSON.stringify(items.map(i => ({ sku: i.sku, units: i.units })))}`);

    const response = await withRetry(() =>
      getInvoicingV1Client().put(`/documents/salesorder/${orderId}`, body)
    );

    log('HoldedClient', `PUT v1 response: ${JSON.stringify(response.data)}`);
    log('HoldedClient', `Updated order ${orderId}, line ${lineId} → ${newUnits} units`);
    return { success: true, orderId, lineId, newUnits };
  } catch (err) {
    const axErr = err as AxiosError;
    const respBody = axErr.response?.data;
    error('HoldedClient', `updateLineUnits failed: ${axErr.message} | Response: ${JSON.stringify(respBody)}`);
    return { success: false, orderId, lineId, newUnits, error: axErr.message };
  }
}

export async function removeLineFromOrder(
  orderId: string,
  lineId: string,
  order: HoldedOrder
): Promise<{ success: boolean; error?: string }> {
  if (isDryRun) {
    log('HoldedClient', `[DRY_RUN] Would remove line ${lineId} from order ${orderId}`);
    return { success: true };
  }

  try {
    const items = order.lines
      .filter((line: HoldedLine) => line.id !== lineId)
      .map((line: HoldedLine) => ({
        productId: line.productId,
        variantId: line.variantId,
        units: line.units,
        price: line.price,
        discount: line.discount,
        taxes: line.taxes,
        name: line.name,
        sku: line.sku,
      }));

    await withRetry(() =>
      getInvoicingV1Client().put(`/documents/salesorder/${orderId}`, { items })
    );

    log('HoldedClient', `Removed line ${lineId} from order ${orderId}`);
    return { success: true };
  } catch (err) {
    const msg = (err as Error).message;
    error('HoldedClient', `removeLineFromOrder failed: ${msg}`);
    return { success: false, error: msg };
  }
}

export async function listAllOrdersForDate(dateStr: string): Promise<HoldedOrder[]> {
  try {
    log('HoldedClient', `listAllOrdersForDate(${dateStr})...`);
    const { dateStrToUnix } = await import('../utils/dates');
    const startTs = dateStrToUnix(dateStr);
    const endTs = startTs + 86399; // fin del día

    const response = await withRetry(() =>
      getInvoicingClient().get<any>('/sales-orders', {
        params: { startDate: startTs, endDate: endTs, limit: 500 },
      })
    );
    const list: any[] = Array.isArray(response.data)
      ? response.data
      : Array.isArray(response.data?.items)
        ? response.data.items
        : [];

    // Filtrar también por fecha en local por si Holded no filtra bien
    const orders: HoldedOrder[] = [];
    for (const item of list) {
      const itemDate = typeof item.date === 'number'
        ? unixToDateStr(item.date)
        : String(item.date ?? '').split('T')[0];
      if (itemDate !== dateStr) continue;
      const full = await getOrder(item.id);
      if (full) orders.push(full);
    }
    log('HoldedClient', `listAllOrdersForDate(${dateStr}): ${orders.length} pedidos`);
    return orders;
  } catch (err) {
    error('HoldedClient', `listAllOrdersForDate failed: ${(err as Error).message}`);
    return [];
  }
}

// Convierte un pedido de venta (salesorder) en un albarán (waybill).
// Escribe en Holded: crea un documento nuevo. Devuelve el ID del albarán creado.
//
// El endpoint /documents/convert de Holded crea el albarán pero NO copia
// precio/descuento de las líneas y lo deja en borrador sin numerar. Por eso,
// justo después de convertir, forzamos las líneas (con precio/descuento/IVA
// del pedido original, vía API v1) y confirmamos el documento para que
// Holded le asigne numeración real — igual que se hace al editar pedidos.
export async function convertOrderToWaybill(orderId: string, order: HoldedOrder): Promise<string | null> {
  if (isDryRun) {
    log('HoldedClient', `[DRY_RUN] Would convert order ${orderId} to waybill`);
    return null;
  }
  try {
    const response = await withRetry(() =>
      getInvoicingClient().post<any>('/documents/convert', {
        source_type: 'salesorder',
        source_id: orderId,
        target_type: 'waybill',
      })
    );
    const waybillId = response.data?.id;
    if (!waybillId) {
      error('HoldedClient', `convertOrderToWaybill(${orderId}): respuesta sin id`);
      return null;
    }
    log('HoldedClient', `convertOrderToWaybill(${orderId}): albarán creado ${waybillId}`);

    await forzarDatosAlbaran(waybillId, order);

    return waybillId;
  } catch (err) {
    error('HoldedClient', `convertOrderToWaybill(${orderId}) failed: ${(err as Error).message}`);
    return null;
  }
}

// Reescribe las líneas del albarán con precio/descuento/IVA del pedido
// original y confirma el documento (status) para que obtenga numeración real.
// No lanza si falla: el albarán ya existe y se puede reintentar o revisar a mano.
async function forzarDatosAlbaran(waybillId: string, order: HoldedOrder): Promise<void> {
  const items = order.lines.map((line: HoldedLine) => ({
    productId: line.productId,
    variantId: line.variantId,
    units: line.units,
    price: line.price,
    discount: line.discount,
    taxes: line.taxes,
    name: line.name,
    sku: line.sku,
  }));

  try {
    await withRetry(() =>
      getInvoicingV1Client().put(`/documents/waybill/${waybillId}`, { items })
    );
    log('HoldedClient', `forzarDatosAlbaran(${waybillId}): líneas con precio/descuento aplicadas`);
  } catch (err) {
    warn('HoldedClient', `forzarDatosAlbaran(${waybillId}) — no se pudieron forzar las líneas: ${(err as Error).message}`);
  }

  try {
    await withRetry(() =>
      getInvoicingV1Client().put(`/documents/waybill/${waybillId}`, { status: 1 })
    );
    log('HoldedClient', `forzarDatosAlbaran(${waybillId}): documento confirmado (numeración real)`);
  } catch (err) {
    warn('HoldedClient', `forzarDatosAlbaran(${waybillId}) — no se pudo confirmar/numerar: ${(err as Error).message}`);
  }
}

// Descarga el PDF (binario) de un albarán ya creado.
export async function downloadWaybillPdf(waybillId: string): Promise<Buffer | null> {
  try {
    const response = await withRetry(() =>
      getInvoicingClient().get(`/waybills/${waybillId}/pdf`, {
        responseType: 'arraybuffer',
        headers: { Accept: 'application/pdf' },
      })
    );
    return Buffer.from(response.data as ArrayBuffer);
  } catch (err) {
    error('HoldedClient', `downloadWaybillPdf(${waybillId}) failed: ${(err as Error).message}`);
    return null;
  }
}

export async function addLineToOrder(
  orderId: string,
  order: HoldedOrder,
  newLine: { productId: string; name: string; sku: string; units: number; price: number; discount: number; taxPct: number }
): Promise<{ success: boolean; error?: string }> {
  const taxKey = `s_iva_${newLine.taxPct}`;

  if (isDryRun) {
    log('HoldedClient', `[DRY_RUN] Would add line to order ${orderId}: ${newLine.units}x ${newLine.name} @ ${newLine.price} (${newLine.discount}% dto)`);
    return { success: true };
  }

  try {
    const existingItems = order.lines.map((line: HoldedLine) => ({
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

    await withRetry(() =>
      getInvoicingV1Client().put(`/documents/salesorder/${orderId}`, {
        items: [...existingItems, newItem],
      })
    );

    log('HoldedClient', `Added line to order ${orderId}: ${newLine.units}x ${newLine.name}`);
    return { success: true };
  } catch (err) {
    const msg = (err as Error).message;
    error('HoldedClient', `addLineToOrder failed: ${msg}`);
    return { success: false, error: msg };
  }
}
