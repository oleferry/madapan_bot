export declare function getTodayDate(): string;
export declare function getTomorrowDate(): string;
export declare function getRelevantProductionDate(earlyCutoffHour?: number): string;
export declare function getDateForDayName(dayName: string, now?: Date): string;
export declare function isAfterCutoff(now?: Date): boolean;
export declare function getDayOfWeek(dateStr: string): number;
export declare function formatDateSpanish(dateStr: string): string;
export declare function unixToDateStr(unix: number): string;
export declare function dateStrToUnix(dateStr: string): number;
export declare function getCurrentWeekDates(): Record<string, string>;
//# sourceMappingURL=dates.d.ts.map