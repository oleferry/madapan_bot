import { BotContext } from './customerFlows';
export interface PizzaSessionData {
    tipo?: 'individual' | 'menu';
    pizzaId?: string;
    postres?: string[];
    cantidad?: number;
    diaRecogida?: string;
    horaRecogida?: string;
    nombre?: string;
    telefono?: string;
    email?: string;
    marketingConsent?: boolean;
}
export declare function handlePizzaStart(ctx: BotContext): Promise<void>;
export declare function handlePizzaTipoElegido(ctx: BotContext, tipo: 'individual' | 'menu'): Promise<void>;
export declare function handlePizzaElegida(ctx: BotContext, pizzaId: string): Promise<void>;
export declare function handlePizzaPostreElegido(ctx: BotContext, numero: number, postreId: string): Promise<void>;
export declare function handlePizzaCantidadElegida(ctx: BotContext, cantidad: number): Promise<void>;
export declare function handlePizzaDiaElegido(ctx: BotContext, dia: string): Promise<void>;
export declare function handlePizzaHoraElegida(ctx: BotContext, hora: string): Promise<void>;
export declare function handlePizzaText(ctx: BotContext): Promise<boolean>;
export declare function handlePizzaMarketing(ctx: BotContext, consent: boolean): Promise<void>;
//# sourceMappingURL=pizzaFlow.d.ts.map