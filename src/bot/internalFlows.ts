import { Telegraf, Context } from 'telegraf';
import * as fs from 'fs';
import { config } from '../config';
import { ChangeLogEntry } from '../types';
import { log, warn } from '../utils/logger';
import { formatDateSpanish } from '../utils/dates';

type AnyContext = Context;

export async function notifyInternal(bot: Telegraf<AnyContext>, message: string): Promise<void> {
  if (!config.telegramInternalChatId) return;
  try {
    await bot.telegram.sendMessage(config.telegramInternalChatId, message);
  } catch (err) {
    warn('InternalFlows', `Failed to notify internal chat: ${(err as Error).message}`);
  }
}

export async function sendDailySummary(bot: Telegraf<AnyContext>, date: string): Promise<void> {
  if (!config.telegramInternalChatId) return;

  const logPath = config.logPath;
  if (!fs.existsSync(logPath)) {
    log('InternalFlows', 'No log file found for daily summary');
    return;
  }

  const raw = fs.readFileSync(logPath, 'utf-8');
  const lines = raw
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as ChangeLogEntry;
      } catch {
        return null;
      }
    })
    .filter((e): e is ChangeLogEntry => e !== null && e.timestamp.startsWith(date));

  if (lines.length === 0) {
    await notifyInternal(bot, `Resumen ${formatDateSpanish(date)}: sin cambios.`);
    return;
  }

  // Group by product
  const byProduct: Record<string, { name: string; delta: number; count: number }> = {};
  const byClient: Record<string, { name: string; count: number }> = {};

  for (const entry of lines) {
    const pk = entry.sku || entry.productName;
    if (!byProduct[pk]) {
      byProduct[pk] = { name: entry.productName, delta: 0, count: 0 };
    }
    byProduct[pk]!.delta += entry.delta;
    byProduct[pk]!.count += 1;

    const ck = entry.telegramId;
    if (!byClient[ck]) {
      byClient[ck] = { name: entry.customerName, count: 0 };
    }
    byClient[ck]!.count += 1;
  }

  let msg = `Resumen ${formatDateSpanish(date)} — ${lines.length} cambios\n\n`;

  msg += `Por producto:\n`;
  for (const p of Object.values(byProduct)) {
    const sign = p.delta >= 0 ? '+' : '';
    msg += `• ${p.name}: ${sign}${p.delta} uds (${p.count} cambios)\n`;
  }

  msg += `\nPor cliente:\n`;
  for (const c of Object.values(byClient)) {
    msg += `• ${c.name}: ${c.count} cambios\n`;
  }

  await notifyInternal(bot, msg);
}
