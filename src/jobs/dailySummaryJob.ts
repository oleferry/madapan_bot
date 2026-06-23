import * as fs from 'fs';
import { Telegraf } from 'telegraf';
import { config } from '../config';
import { initNotifier, sendToAdmin } from '../services/notifier';
import { log, warn } from '../utils/logger';
import { ChangeLogEntry } from '../types';
import { toZonedTime, format } from 'date-fns-tz';

function todayInMadrid(): string {
  const now = toZonedTime(new Date(), config.timezone);
  return format(now, 'yyyy-MM-dd', { timeZone: config.timezone });
}

function readTodayChanges(): ChangeLogEntry[] {
  const today = todayInMadrid();
  try {
    if (!fs.existsSync(config.logPath)) return [];
    const lines = fs.readFileSync(config.logPath, 'utf-8').split('\n').filter(Boolean);
    return lines
      .map(l => {
        try { return JSON.parse(l) as ChangeLogEntry; } catch { return null; }
      })
      .filter((e): e is ChangeLogEntry => e !== null && e.timestamp.startsWith(today));
  } catch (err) {
    warn('DailySummaryJob', `Error leyendo log: ${(err as Error).message}`);
    return [];
  }
}

function buildSummaryText(entries: ChangeLogEntry[], today: string): string {
  if (entries.length === 0) {
    return `📋 Resumen de cambios — ${today}\n\nNo hubo cambios en los pedidos hoy.`;
  }

  const byClient = new Map<string, ChangeLogEntry[]>();
  for (const e of entries) {
    if (!byClient.has(e.customerName)) byClient.set(e.customerName, []);
    byClient.get(e.customerName)!.push(e);
  }

  let text = `📋 Resumen de cambios — ${today}\n`;
  text += `Total: ${entries.length} cambio(s) en ${byClient.size} cliente(s)\n`;
  if (config.dryRun) text += `⚠️ MODO SIMULACIÓN ACTIVO\n`;
  text += '\n';

  for (const [clientName, changes] of byClient) {
    text += `👤 ${clientName}\n`;
    for (const c of changes) {
      const hora = format(toZonedTime(new Date(c.timestamp), config.timezone), 'HH:mm', { timeZone: config.timezone });
      const signo = c.delta > 0 ? '+' : '';
      text += `  • ${c.productName}: ${c.previousUnits} → ${c.newUnits} uds (${signo}${c.delta}) a las ${hora}\n`;
    }
  }

  return text.trim();
}

export function scheduleDailySummary(bot: Telegraf): void {
  initNotifier(bot.telegram);

  let lastSentDate = '';

  setInterval(() => {
    const now = toZonedTime(new Date(), config.timezone);
    const currentHour = now.getHours();
    const today = format(now, 'yyyy-MM-dd', { timeZone: config.timezone });

    if (currentHour === config.autoCutoffHour && lastSentDate !== today) {
      lastSentDate = today;
      const entries = readTodayChanges();
      const text = buildSummaryText(entries, today);
      sendToAdmin(text).catch(err =>
        warn('DailySummaryJob', `Error enviando resumen: ${(err as Error).message}`)
      );
      log('DailySummaryJob', `Resumen diario enviado para ${today} (${entries.length} cambios)`);
    }
  }, 60_000);

  log('DailySummaryJob', `Resumen diario programado a las ${config.autoCutoffHour}:00 (${config.timezone})`);
}
