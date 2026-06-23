import { Telegraf } from 'telegraf';
import { config } from '../config';
import { initNotifier, sendToAdmin } from '../services/notifier';
import { buildProductionSummary } from '../services/productionSummary';
import { log, warn } from '../utils/logger';
import { toZonedTime, format } from 'date-fns-tz';

// Envía el resumen de producción para el día siguiente a las 22:00 (hora de cierre de pedidos)
export function scheduleProductionSummary(bot: Telegraf): void {
  initNotifier(bot.telegram);

  let lastSentDate = '';

  setInterval(async () => {
    const now = toZonedTime(new Date(), config.timezone);
    const currentHour = now.getHours();
    const today = format(now, 'yyyy-MM-dd', { timeZone: config.timezone });

    if (currentHour === config.autoCutoffHour && lastSentDate !== today) {
      lastSentDate = today;

      // Calcular día siguiente
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = format(tomorrow, 'yyyy-MM-dd', { timeZone: config.timezone });
      const tomorrowDow = tomorrow.getDay(); // 0=Dom…6=Sáb

      try {
        const text = await buildProductionSummary(tomorrowStr, tomorrowDow);
        await sendToAdmin(text);
        log('ProductionSummaryJob', `Resumen de producción enviado para ${tomorrowStr}`);
      } catch (err) {
        warn('ProductionSummaryJob', `Error: ${(err as Error).message}`);
      }
    }
  }, 60_000);

  log('ProductionSummaryJob', `Resumen de producción programado a las ${config.autoCutoffHour}:00 (${config.timezone})`);
}
