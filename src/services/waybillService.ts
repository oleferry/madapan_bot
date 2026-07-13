import * as fs from 'fs';
import * as path from 'path';
import { PDFDocument } from 'pdf-lib';
import { config } from '../config';
import { log, warn } from '../utils/logger';
import * as holdedClient from './holdedClient';
import { HoldedOrder } from '../types';

// ── Mapa persistente pedido → albarán ────────────────────────────────────────
// Evita convertir el mismo pedido dos veces (cada conversión crea un documento
// real y permanente en Holded) si el job se relanza o el comando manual se usa
// más de una vez el mismo día.

const MAP_PATH = path.resolve(config.waybillMapPath);

function loadMap(): Record<string, string> {
  try {
    if (!fs.existsSync(MAP_PATH)) return {};
    return JSON.parse(fs.readFileSync(MAP_PATH, 'utf-8'));
  } catch (err) {
    warn('WaybillService', `Error leyendo mapa de albaranes: ${(err as Error).message}`);
    return {};
  }
}

function saveMap(map: Record<string, string>): void {
  fs.mkdirSync(path.dirname(MAP_PATH), { recursive: true });
  fs.writeFileSync(MAP_PATH, JSON.stringify(map, null, 2));
}

// Devuelve el ID del albarán de un pedido, convirtiéndolo si aún no existe.
async function ensureWaybillId(order: HoldedOrder): Promise<string | null> {
  const map = loadMap();
  if (map[order.id]) return map[order.id];

  const waybillId = await holdedClient.convertOrderToWaybill(order.id, order);
  if (!waybillId) return null;

  map[order.id] = waybillId;
  saveMap(map);
  return waybillId;
}

export interface DailyWaybillsResult {
  totalOrders: number;
  pdfBytes: Uint8Array | null;
  failed: Array<{ ref: string; reason: string }>;
}

// Genera el PDF combinado del día: convierte cada pedido en albarán (o reutiliza
// el ya existente), descarga cada PDF y los fusiona en un único documento.
export async function buildDailyWaybillsPdf(dateStr: string): Promise<DailyWaybillsResult> {
  const orders = await holdedClient.listAllOrdersForDate(dateStr);
  const failed: DailyWaybillsResult['failed'] = [];

  if (orders.length === 0) {
    return { totalOrders: 0, pdfBytes: null, failed };
  }

  const merged = await PDFDocument.create();
  let pagesAdded = 0;

  for (const order of orders) {
    const ref = order.docNumber ?? order.contactName ?? order.id;
    try {
      const waybillId = await ensureWaybillId(order);
      if (!waybillId) {
        failed.push({ ref, reason: 'No se pudo convertir a albarán' });
        continue;
      }
      const pdfBuf = await holdedClient.downloadWaybillPdf(waybillId);
      if (!pdfBuf) {
        failed.push({ ref, reason: 'No se pudo descargar el PDF del albarán' });
        continue;
      }
      const src = await PDFDocument.load(pdfBuf);
      const copiedPages = await merged.copyPages(src, src.getPageIndices());
      for (const p of copiedPages) merged.addPage(p);
      pagesAdded++;
    } catch (err) {
      failed.push({ ref, reason: (err as Error).message });
    }
  }

  log('WaybillService', `buildDailyWaybillsPdf(${dateStr}): ${pagesAdded}/${orders.length} albaranes incluidos, ${failed.length} fallos`);

  if (pagesAdded === 0) {
    return { totalOrders: orders.length, pdfBytes: null, failed };
  }

  const pdfBytes = await merged.save();
  return { totalOrders: orders.length, pdfBytes, failed };
}
