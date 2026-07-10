import { Telegraf, Telegram } from 'telegraf';
import { config } from '../config';
import { initNotifier } from '../services/notifier';
import { buildDailyWaybillsPdf } from '../services/waybillService';
import { log, warn } from '../utils/logger';
import { toZonedTime, format } from 'date-fns-tz';

// Genera el PDF combinado de albaranes del día y lo envía al chat de admin.
// Reutilizable tanto por el job programado como por el comando manual /albaranes.
export async function sendDailyWaybills(telegram: Telegram, dateStr: string): Promise<void> {
  const chatId = config.telegramInternalChatId;
  if (!chatId) {
    warn('DailyWaybillsJob', 'TELEGRAM_INTERNAL_CHAT_ID no configurado — no se puede enviar');
    return;
  }

  const result = await buildDailyWaybillsPdf(dateStr);

  if (result.totalOrders === 0) {
    await telegram.sendMessage(chatId, `📄 Albaranes ${dateStr}\n\nNo hay pedidos para ese día.`);
    return;
  }

  if (!result.pdfBytes) {
    await telegram.sendMessage(
      chatId,
      `📄 Albaranes ${dateStr}\n\n⚠️ No se pudo generar ningún albarán (${result.totalOrders} pedido(s), ${result.failed.length} fallo(s)).\n` +
      result.failed.map(f => `• ${f.ref}: ${f.reason}`).join('\n')
    );
    return;
  }

  const okCount = result.totalOrders - result.failed.length;
  let caption = `📄 Albaranes ${dateStr} — ${okCount}/${result.totalOrders} pedido(s)`;
  if (result.failed.length > 0) {
    caption += `\n⚠️ Fallaron: ${result.failed.map(f => f.ref).join(', ')}`;
  }

  await telegram.sendDocument(
    chatId,
    { source: Buffer.from(result.pdfBytes), filename: `albaranes-${dateStr}.pdf` },
    { caption }
  );
  log('DailyWaybillsJob', `Albaranes enviados para ${dateStr}: ${okCount}/${result.totalOrders}`);
}

// Programa el envío diario a la hora configurada (WAYBILLS_JOB_HOUR, por defecto 6:00)
export function scheduleDailyWaybills(bot: Telegraf): void {
  initNotifier(bot.telegram);

  let lastSentDate = '';

  setInterval(async () => {
    const now = toZonedTime(new Date(), config.timezone);
    const currentHour = now.getHours();
    const today = format(now, 'yyyy-MM-dd', { timeZone: config.timezone });

    if (currentHour === config.waybillsJobHour && lastSentDate !== today) {
      lastSentDate = today;
      try {
        await sendDailyWaybills(bot.telegram, today);
      } catch (err) {
        warn('DailyWaybillsJob', `Error: ${(err as Error).message}`);
      }
    }
  }, 60_000);

  log('DailyWaybillsJob', `Albaranes diarios programados a las ${config.waybillsJobHour}:00 (${config.timezone})`);
}
