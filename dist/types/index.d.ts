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
    id: string;
    productId: string;
    variantId: string;
    sku: string;
    name: string;
    units: number;
    price: number;
    rawPrice: string;
    rawDiscount: string;
    discount: number;
    taxes: string[];
    _raw: Record<string, unknown>;
}
export interface HoldedOrder {
    id: string;
    contactId: string;
    contactName: string;
    date: string;
    status: string;
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
    deliveryDate: string | null;
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
//# sourceMappingURL=index.d.ts.map