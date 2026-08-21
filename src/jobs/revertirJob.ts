import cron from 'node-cron';
import { Telegraf } from 'telegraf';
import { Markup } from 'telegraf';
import { toZonedTime, format } from 'date-fns-tz';
import * as revertir from '../services/revertirService';
import { config } from '../config';
import { log } from '../utils/logger';

// Recordatorio de cambios temporales sin deshacer.
//
// Salta el día de la carga semanal y una hora antes que ella, para que dé
// tiempo a deshacerlos antes de que esos ceros se suban a Holded.

export function scheduleRecordatorioRevertir(bot: Telegraf<never>): void {
  const hora = Math.max(0, config.weeklyOrdersHour - 1);
  cron.schedule(`0 ${hora} * * *`, () => void avisar(bot), { timezone: config.timezone });
  log('RevertirJob', `Recordatorio de cambios temporales a las ${hora}:00`);
}

export async function avisar(bot: Telegraf<never>, forzar = false): Promise<number> {
  const hoy = format(toZonedTime(new Date(), config.timezone), 'yyyy-MM-dd', { timeZone: config.timezone });
  const lista = forzar ? revertir.pendientes() : revertir.paraAvisar(hoy);
  if (!lista.length) return 0;

  for (const p of lista) {
    const texto = revertir.texto(p);
    const teclado = Markup.inlineKeyboard([
      [Markup.button.callback('↩️ Deshacer ahora', `rev_si|${p.id}`)],
      [Markup.button.callback('Dejarlo como está', `rev_no|${p.id}`)],
    ]);
    for (const chatId of config.adminTelegramIds) {
      try {
        await bot.telegram.sendMessage(chatId, texto, teclado);
      } catch (err) {
        log('RevertirJob', `No se pudo avisar a ${chatId}: ${(err as Error).message}`);
      }
    }
    if (!forzar) revertir.marcarAvisado(p.id, hoy);
  }
  log('RevertirJob', `Avisados ${lista.length} cambios temporales`);
  return lista.length;
}
