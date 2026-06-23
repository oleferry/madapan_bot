import * as fs from 'fs';
import * as path from 'path';

interface CatalogProduct {
  cod: string;
  name: string;
  sku: string;
  holdedId: string | null;
  iva: number;
  special24h?: boolean;
  prices: Record<string, number>;
}

interface CatalogClient {
  cod: string;
  name: string;
  discount: number;
  tarifa: string;
}

interface Catalog {
  products: CatalogProduct[];
  clients: Record<string, CatalogClient>;
}

let catalog: Catalog | null = null;

function load(): Catalog {
  if (catalog) return catalog;
  const filePath = path.resolve('data/catalog.json');
  const raw = fs.readFileSync(filePath, 'utf-8');
  catalog = JSON.parse(raw) as Catalog;
  return catalog;
}

export function getClientByNif(nif: string): CatalogClient | null {
  const c = load();
  const key = nif.trim().toUpperCase().replace(/[\s\-]/g, '');
  return c.clients[key] ?? null;
}

export function getAllProducts(): CatalogProduct[] {
  return load().products;
}

export function getProductByCod(cod: string): CatalogProduct | null {
  return load().products.find(p => p.cod === cod) ?? null;
}

export function getProductBySku(sku: string): CatalogProduct | null {
  return load().products.find(p => p.sku === sku) ?? null;
}

// Calcula el precio neto para un cliente (con su tarifa y descuento)
export function getClientPrice(product: CatalogProduct, tarifa: string, discountPct: number): number {
  const base = product.prices[tarifa] ?? product.prices['Tarifa 2025'] ?? 0;
  return Math.round(base * (1 - discountPct / 100) * 100000) / 100000;
}

// Devuelve solo el precio base de tarifa (sin descuento — Holded aplica el descuento por separado)
export function getTarifaPrice(product: CatalogProduct, tarifa: string): number {
  return product.prices[tarifa] ?? product.prices['Tarifa 2025'] ?? 0;
}

// Productos disponibles para añadir (los que tienen holdedId)
export function getAvailableProducts(): CatalogProduct[] {
  return load().products.filter(p => p.holdedId !== null);
}
