export interface Customer {
  telegramId: string;
  holdedContactId: string;
  name: string;
  phone: string;
  tarifa?: string;
  discount?: number;
}

export interface HoldedContact {
  id: string;
  name: string;
  phone?: string;
  mobile?: string;
  code?: string;
  vat_number?: string;
}

export interface HoldedLine {
  id: string;         // line_id — para identificar la línea localmente
  productId: string;  // product_id — lo que Holded necesita en el PUT
  variantId: string;  // variant_id — requerido por Holded en el PUT
  sku: string;
  name: string;
  units: number;
  price: number;
  rawPrice: string;    // precio original de Holded sin parsear, e.g. "1,44"
  rawDiscount: string; // descuento original de Holded sin parsear
  discount: number;
  taxes: string[];     // e.g. ["s_iva_4"]
  _raw: Record<string, unknown>; // objeto raw completo de Holded para PUT
}

export interface HoldedOrder {
  id: string;
  docNumber?: string;
  contactId: string;
  contactName: string;
  date: string; // "YYYY-MM-DD"
  status: string; // "pending" | "approved" | "invoiced" | ...
  lines: HoldedLine[];
  notes?: string;
}

export interface HoldedUpdateResult {
  success: boolean;
  orderId: string;
  lineId: string;
  newUnits: number;
  error?: string;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export interface ParsedChange {
  status: 'ok' | 'ambiguous' | 'unsupported';
  deliveryDate: string | null; // YYYY-MM-DD
  actions: Array<{
    productAlias: string;
    type: 'increment' | 'decrement' | 'set_quantity';
    quantity: number;
  }>;
  reason?: string;
}

export interface ChangeLogEntry {
  timestamp: string;
  telegramId: string;
  customerName: string;
  orderId: string;
  lineId: string;
  productName: string;
  sku: string;
  previousUnits: number;
  newUnits: number;
  delta: number;
  source: 'button' | 'text';
  dryRun: boolean;
}
