import { Customer, HoldedOrder, HoldedLine, ValidationResult } from '../types';
export declare function getOrRegisterCustomer(telegramId: string, nif?: string): Promise<Customer | null>;
export declare function getOrderForDate(customer: Customer, dateStr: string): Promise<HoldedOrder | null>;
export declare function addProductToOrder(customer: Customer, order: HoldedOrder, productCod: string, units: number): Promise<{
    success: boolean;
    message: string;
}>;
export declare function getThreshold(lineName: string, afterCutoff: boolean): number;
export declare function validateDelta(line: HoldedLine, delta: number, afterCutoff: boolean): ValidationResult;
export declare function changeLineUnits(params: {
    customer: Customer;
    order: HoldedOrder;
    lineId: string;
    newUnits: number;
    source: 'button' | 'text';
}): Promise<{
    success: boolean;
    message: string;
}>;
//# sourceMappingURL=orderService.d.ts.map