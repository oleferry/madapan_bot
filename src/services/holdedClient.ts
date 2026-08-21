import axios, { AxiosInstance, AxiosError } from 'axios';
import { config, isDryRun } from '../config';
import { HoldedContact, HoldedOrder, HoldedLine, HoldedUpdateResult } from '../types';
import { log, warn, error } from '../utils/logger';
import { unixToDateStr } from '../utils/dates';
import * as catalogService from './catalogService';

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
export function getInvoicingV1Client(): AxiosInstance {
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

// Holded almacena los precios con 5 decimales pero su API solo devuelve 2
// ("1,73" en vez de 1,73077). Como al cambiar una cantidad hay que reenviar
// TODAS las líneas, reenviar ese precio truncado degradaría el pedido de forma
// permanente. Esta función recupera la precisión desde el catálogo.
//
// Es deliberadamente conservadora: solo sustituye el precio si el del catálogo,
// redondeado a 2 decimales, coincide con el que devolvió Holded. Así nunca
// cambia un precio real (por ejemplo, uno pactado a mano para una línea
// concreta), solo restaura los decimales que la API se dejó por el camino.
function precisePrice(line: HoldedLine, tarifa?: string): number {
  if (!tarifa) return line.price;
  const product = catalogService.getProductBySku(line.sku);
  if (!product) return line.price;
  const full = catalogService.getTarifaPrice(product, tarifa);
  if (!full) return line.price;
  return Math.round(full * 100) / 100 === line.price ? full : line.price;
}

export async function updateLineUnits(
  orderId: string,
  lineId: string,
  newUnits: number,
  order: HoldedOrder,
  tarifa?: string
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
      price: precisePrice(line, tarifa),
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
  order: HoldedOrder,
  tarifa?: string
): Promise<{ success: boolean; error?: string; orderDeleted?: boolean }> {
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
        price: precisePrice(line, tarifa),
        discount: line.discount,
        taxes: line.taxes,
        name: line.name,
        sku: line.sku,
      }));

    // Quitar la última línea dejaría el pedido sin ninguna. Holded ignora en
    // silencio un PUT con "items" vacío (responde OK y no cambia nada), así
    // que el pedido hay que borrarlo entero.
    if (items.length === 0) {
      await withRetry(() =>
        getInvoicingV1Client().delete(`/documents/salesorder/${orderId}`)
      );
      log('HoldedClient', `Pedido ${orderId} borrado: se quitó su única línea`);
      return { success: true, orderDeleted: true };
    }

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

// ── Compras: artículos y proveedores ─────────────────────────────────────────

export interface ProductoHolded {
  id: string; name: string; sku: string; purchasePrice: number;
  proveedorId?: string;   // el que esté asignado a mano en la ficha de Holded
}

// Holded devuelve el proveedor de la ficha como {"$oid": "..."} y deja
// contactName vacío. Si se lee tal cual, se compara un objeto con un id y
// nunca casa: por eso "Cerveza" no encontraba a Josefina de la Calle.
function idDeContacto(v: unknown): string | undefined {
  if (!v) return undefined;
  if (typeof v === 'string') return v || undefined;
  const oid = (v as { $oid?: string }).$oid;
  return oid || undefined;
}
export interface ProveedorHolded { id: string; name: string; email: string; }

// Se cachean en memoria: el catálogo entero son ~240 artículos y 195 contactos,
// y se consultan en cada búsqueda mientras se apunta la compra.
let cacheProductos: { datos: ProductoHolded[]; en: number } | null = null;
let cacheProveedores: { datos: ProveedorHolded[]; en: number } | null = null;
const VIDA_CACHE = 30 * 60 * 1000;

export async function listProducts(): Promise<ProductoHolded[]> {
  if (cacheProductos && Date.now() - cacheProductos.en < VIDA_CACHE) return cacheProductos.datos;
  const r = await withRetry(() => getInvoicingV1Client().get<any[]>('/products'));
  const datos = (r.data ?? [])
    .filter(p => p.forPurchase)
    .map(p => {
      const proveedorId = idDeContacto(p.contactId);
      return {
        id: p.id, name: p.name ?? '', sku: p.sku ?? '',
        purchasePrice: Number(p.purchasePrice) || 0,
        ...(proveedorId ? { proveedorId } : {}),
      };
    });
  cacheProductos = { datos, en: Date.now() };
  log('HoldedClient', `Catálogo de compra: ${datos.length} artículos`);
  return datos;
}

export async function listSuppliers(): Promise<ProveedorHolded[]> {
  if (cacheProveedores && Date.now() - cacheProveedores.en < VIDA_CACHE) return cacheProveedores.datos;
  const r = await withRetry(() => getInvoicingV1Client().get<any[]>('/contacts'));
  const datos = (r.data ?? [])
    .filter(c => c.type === 'supplier')
    .map(c => ({ id: c.id, name: c.name ?? '', email: c.email ?? '' }));
  cacheProveedores = { datos, en: Date.now() };
  return datos;
}

// Búsqueda tolerante: sin acentos, por palabras sueltas y en cualquier orden,
// para que "coca colas" encuentre "Coca - Cola".
function normalizar(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ');
}

export function puntuar(nombre: string, consulta: string): number {
  const n = normalizar(nombre);
  const palabras = normalizar(consulta).split(/\s+/).filter(p => p.length > 2);
  if (!palabras.length) return 0;
  let puntos = 0;
  for (const p of palabras) {
    // El singular de lo que se escribe en plural ("colas" → "cola").
    const raiz = p.replace(/(es|s)$/, '');
    if (n.includes(p) || (raiz.length > 2 && n.includes(raiz))) puntos += 1;
  }
  return puntos / palabras.length;
}

export async function buscarProductos(consulta: string, limite = 6): Promise<ProductoHolded[]> {
  const todos = await listProducts();
  return todos
    .map(p => ({ p, s: puntuar(p.name, consulta) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || a.p.name.length - b.p.name.length)
    .slice(0, limite)
    .map(x => x.p);
}

export async function buscarProveedores(consulta: string, limite = 6): Promise<ProveedorHolded[]> {
  const todos = await listSuppliers();
  return todos
    .map(p => ({ p, s: puntuar(p.name, consulta) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || a.p.name.length - b.p.name.length)
    .slice(0, limite)
    .map(x => x.p);
}

// Pedido de compra al proveedor. Se crea SIN aprobar: es un borrador que
// alguien revisa en Holded, no un documento contable definitivo.
export async function createPurchaseOrder(
  contactId: string,
  lineas: Array<{ name: string; sku?: string; units: number; price: number }>,
  notas?: string
): Promise<string | null> {
  if (isDryRun) {
    log('HoldedClient', `[DRY_RUN] Pedido de compra a ${contactId}, ${lineas.length} líneas`);
    return 'dry-run';
  }
  try {
    const r = await withRetry(() =>
      getInvoicingV1Client().post<any>('/documents/purchaseorder', {
        contactId,
        date: Math.floor(Date.now() / 1000),
        ...(notas ? { notes: notas } : {}),
        items: lineas.map(l => ({
          name: l.name,
          ...(l.sku ? { sku: l.sku } : {}),
          units: l.units,
          price: l.price,
        })),
      })
    );
    const id = r.data?.id ?? null;
    log('HoldedClient', `Pedido de compra creado: ${id}`);
    return id;
  } catch (err) {
    warn('HoldedClient', `No se pudo crear el pedido de compra: ${(err as Error).message}`);
    return null;
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
// Confirmado con soporte de Holded: /documents/convert (v2) SIEMPRE crea el
// documento en borrador (sin numeración, PDF sin precio/descuento) y no
// respeta approveDoc/draft — no hay forma de "aprobar" ese borrador después.
// La solución es crear el albarán directamente vía API v1 (POST, no PUT)
// copiando las líneas del pedido, con approveDoc:true. Verificado: el
// resultado queda con draft:false y numeración real (ej. "A262910").
export async function convertOrderToWaybill(orderId: string): Promise<string | null> {
  if (isDryRun) {
    log('HoldedClient', `[DRY_RUN] Would convert order ${orderId} to waybill`);
    return null;
  }

  const order = await getOrder(orderId);
  if (!order) {
    error('HoldedClient', `convertOrderToWaybill(${orderId}): no se pudo cargar el pedido`);
    return null;
  }

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
    const response = await withRetry(() =>
      getInvoicingV1Client().post<any>('/documents/waybill', {
        contactId: order.contactId,
        date: Math.floor(Date.now() / 1000),
        items,
        approveDoc: true,
      })
    );
    const waybillId = response.data?.id;
    if (!waybillId) {
      error('HoldedClient', `convertOrderToWaybill(${orderId}): respuesta sin id`);
      return null;
    }
    log('HoldedClient', `convertOrderToWaybill(${orderId}): albarán creado ${waybillId} (nº ${response.data?.invoiceNum ?? '?'})`);
    return waybillId;
  } catch (err) {
    error('HoldedClient', `convertOrderToWaybill(${orderId}) failed: ${(err as Error).message}`);
    return null;
  }
}

// Crea un pedido de venta con sus líneas. Igual que con los albaranes,
// approveDoc:true es imprescindible para que quede aprobado y numerado en vez
// de en borrador (los borradores no muestran precios en el PDF).
export async function createSalesOrder(
  contactId: string,
  fechaIso: string,
  lines: Array<{ sku: string; name: string; units: number; price: number; discount: number; taxPct: number }>
): Promise<{ ok: boolean; id?: string; docNumber?: string; error?: string }> {
  if (isDryRun) {
    log('HoldedClient', `[DRY_RUN] Crearía pedido para ${contactId} el ${fechaIso} con ${lines.length} líneas`);
    return { ok: true };
  }

  const [y, m, d] = fechaIso.split('-').map(Number);
  const ts = Math.floor(new Date(y!, m! - 1, d!, 12, 0, 0).getTime() / 1000);

  // Nota: Holded ignora este "price". Reconoce la línea por el SKU y resuelve
  // el precio por su cuenta: la tarifa del contacto, o el precio base del
  // producto si el contacto no tiene tarifa. Comprobado sobre 162 líneas
  // reales: ninguna conservó un precio libre. Por eso las tarifas tienen que
  // estar bien asignadas en la ficha de cada contacto de Holded; enviarlas
  // aquí no sirve de nada.
  const items = lines.map(l => {
    const product = catalogService.getProductBySku(l.sku);
    return {
      productId: product?.holdedId ?? undefined,
      name: l.name,
      sku: l.sku,
      units: l.units,
      price: l.price,
      discount: l.discount,
      taxes: [`s_iva_${l.taxPct}`],
    };
  });

  try {
    const r = await withRetry(() =>
      getInvoicingV1Client().post<any>('/documents/salesorder', {
        contactId,
        date: ts,
        items,
        approveDoc: true,
      })
    );
    const id = r.data?.id;
    if (!id) return { ok: false, error: `respuesta sin id: ${JSON.stringify(r.data)}` };
    log('HoldedClient', `Pedido creado ${id} (nº ${r.data?.invoiceNum ?? '?'}) para ${contactId} el ${fechaIso}`);
    return { ok: true, id, docNumber: r.data?.invoiceNum };
  } catch (err) {
    const ax = err as AxiosError;
    const msg = `${ax.message} ${JSON.stringify(ax.response?.data ?? '')}`.slice(0, 200);
    error('HoldedClient', `createSalesOrder failed (${contactId}, ${fechaIso}): ${msg}`);
    return { ok: false, error: msg };
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
  newLine: { productId: string; name: string; sku: string; units: number; price: number; discount: number; taxPct: number },
  tarifa?: string
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
      price: precisePrice(line, tarifa),
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
