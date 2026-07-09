import { HoldedContact, HoldedOrder, HoldedUpdateResult } from '../types';
export declare function findContactByNif(nif: string): Promise<HoldedContact | null>;
export declare function listOrdersByContact(contactId: string): Promise<any[]>;
export declare function getOrder(orderId: string): Promise<HoldedOrder | null>;
export declare function findOrderByContactAndDate(contactId: string, dateStr: string): Promise<HoldedOrder | null>;
export declare function isOrderEditable(order: HoldedOrder): boolean;
export declare function updateLineUnits(orderId: string, lineId: string, newUnits: number, order: HoldedOrder): Promise<HoldedUpdateResult>;
export declare function removeLineFromOrder(orderId: string, lineId: string, order: HoldedOrder): Promise<{
    success: boolean;
    error?: string;
}>;
export declare function listAllOrdersForDate(dateStr: string): Promise<HoldedOrder[]>;
export declare function addLineToOrder(orderId: string, order: HoldedOrder, newLine: {
    productId: string;
    name: string;
    sku: string;
    units: number;
    price: number;
    discount: number;
    taxPct: number;
}): Promise<{
    success: boolean;
    error?: string;
}>;
//# sourceMappingURL=holdedClient.d.ts.map