import { getInvoicingV1Client } from './holdedClient';
import { log, warn } from '../utils/logger';

// Precios de venta al público, tal y como están en Holded.
//
// Se usa el campo "total" y no "price": el primero lleva el IVA incluido, que
// es lo que paga el cliente. Poner el precio base en un mensaje al público
// sería enseñar una cifra que luego no cuadra al cobrar.

const VIDA_CACHE = 30 * 60 * 1000;

let cache: { precios: Map<string, number>; en: number } | null = null;

export function normalizar(s: string): string {
  return (s ?? '').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

export async function precios(): Promise<Map<string, number>> {
  if (cache && Date.now() - cache.en < VIDA_CACHE) return cache.precios;

  const r = await getInvoicingV1Client().get<any[]>('/products');
  const m = new Map<string, number>();
  for (const p of r.data ?? []) {
    const pvp = Number(p.total) || 0;
    if (p.name && pvp > 0) m.set(normalizar(p.name), pvp);
  }
  cache = { precios: m, en: Date.now() };
  log('Precios', `${m.size} productos con precio`);
  return m;
}

// Devuelve 0 si no se conoce el producto. Quien lo use tiene que contar
// cuántos han salido a 0 y decirlo: un total al que le faltan líneas es peor
// que no dar total.
export function precioDe(nombre: string, tabla: Map<string, number>): number {
  const p = tabla.get(normalizar(nombre));
  if (p === undefined) warn('Precios', `Sin precio: "${nombre}"`);
  return p ?? 0;
}

export function _reset(): void { cache = null; }
