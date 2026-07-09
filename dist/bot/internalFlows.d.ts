import { Telegraf, Context } from 'telegraf';
type AnyContext = Context;
export declare function notifyInternal(bot: Telegraf<AnyContext>, message: string): Promise<void>;
export declare function sendDailySummary(bot: Telegraf<AnyContext>, date: string): Promise<void>;
export {};
//# sourceMappingURL=internalFlows.d.ts.map