import { Context } from 'telegraf';
import { Customer } from '../types';
export interface SessionData {
    step: 'idle' | 'awaiting_phone' | 'selecting_product' | 'selecting_day' | 'entering_exact' | 'admin_awaiting_nif' | 'pizza_awaiting_name' | 'pizza_awaiting_phone' | 'pizza_awaiting_email' | 'pizza_awaiting_marketing' | 'admin_awaiting_pizza_stock';
    isAdmin?: boolean;
    pizzaOrder?: import('./pizzaFlow').PizzaSessionData;
    selectedDate?: string;
    selectedOrderId?: string;
    selectedLineId?: string;
    selectedLineName?: string;
    selectedLineCurrentUnits?: number;
    customer?: Customer;
    orderLines?: Array<{
        id: string;
        name: string;
        units: number;
    }>;
    addingProduct?: boolean;
    pendingCancelLineIdx?: number;
}
export type BotContext = Context & {
    session: SessionData;
};
export declare function handleStart(ctx: BotContext): Promise<void>;
export declare function handleContact(ctx: BotContext): Promise<void>;
export declare function handleIdentifyClient(ctx: BotContext): Promise<void>;
export declare function handleMainMenu(ctx: BotContext): Promise<void>;
export declare function handleAdminSelectClient(ctx: BotContext): Promise<void>;
export declare function handleAdminByNif(ctx: BotContext): Promise<void>;
export declare function handleAdminClientChosen(ctx: BotContext, nif: string): Promise<void>;
export declare function handleAdminPizzaStockPrompt(ctx: BotContext): Promise<void>;
export declare function handleAdminPizzaPedidos(ctx: BotContext): Promise<void>;
export declare function handleViewOrder(ctx: BotContext, dateStr?: string): Promise<void>;
export declare function handleChangeOrder(ctx: BotContext, dateStr: string): Promise<void>;
export declare function handleProductSelected(ctx: BotContext, lineIdx: number): Promise<void>;
export declare function handleQuantityButton(ctx: BotContext, lineIdx: number, delta: number): Promise<void>;
export declare function handleExactQuantity(ctx: BotContext, lineIdx: number): Promise<void>;
export declare function handleText(ctx: BotContext): Promise<void>;
export declare function handleDaySelection(ctx: BotContext): Promise<void>;
export declare function handleContactMadapan(ctx: BotContext): Promise<void>;
export declare function handleShowAddProduct(ctx: BotContext, dateStr: string): Promise<void>;
export declare function handleAddProductSelected(ctx: BotContext, productCod: string): Promise<void>;
export declare function handleAddProductQuantity(ctx: BotContext, productCod: string, units: number): Promise<void>;
export declare function handleCancelLineConfirm(ctx: BotContext, lineIdx: number): Promise<void>;
export declare function handleCancelLine(ctx: BotContext, lineIdx: number): Promise<void>;
export declare function handleOrderHistory(ctx: BotContext): Promise<void>;
//# sourceMappingURL=customerFlows.d.ts.map