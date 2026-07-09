import { Telegraf } from 'telegraf';
import { ChangeLogEntry } from '../types';
export declare function readTodayChanges(): ChangeLogEntry[];
export declare function buildSummaryText(entries: ChangeLogEntry[], today: string): string;
export declare function scheduleDailySummary(bot: Telegraf): void;
//# sourceMappingURL=dailySummaryJob.d.ts.map