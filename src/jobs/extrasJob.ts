import cron from 'node-cron';
import { Telegraf, Telegram } from 'telegraf';
import { toZonedTime, format } from 'date-fns-tz';
import * as encargos from '../services/encargosService';
import * as penas from '../services/penasService';
import { formatDateSpanish } from '../utils/dates';
import { config } from '../config';
import { log, error } from '../utils/logger';

// Aviso diario de lo que hay pedido FUERA de la producción habitual.
//
// Existe por un problema real: aparecieron empanadas en la producción del día
// y no había ingredientes para hacerlas. El encargo estaba bien apuntado, pero
// nadie lo vio hasta la mañana, y para entonces ya no había nada que hacer.
//
// Por eso mira cinco días por delante y no solo el siguiente: una empanada se
// puede preparar con un día, pero el relleno hay que comprarlo antes.

const DIAS_VISTA = 5;

export function scheduleExtras(bot: Telegraf<never>): void {
  cron.schedule(`0 ${config.extrasHour} * * *`, () => void avisar(bot.telegram),
    { timezone: config.timezone });
  log('ExtrasJob', `Aviso de pedidos extra a las ${config.extrasHour}:00`);
}

function proximosDias(desde: string, n: number): string[] {
  const d = new Date(`${desde}T12:00:00Z`);
  return Array.from({ length: n }, (_, i) => {
    const x = new Date(d);
    x.setUTCDate(x.getUTCDate() + i);
    return x.toISOString().slice(0, 10);
  });
}

export function construirTexto(hoy: string): string {
  const dias = proximosDias(hoy, DIAS_VISTA);
  const bloques: string[] = [];

  for (const fecha of dias) {
    const delDia = encargos.encargosDelDia(fecha);
    const dePenas = penas.totalesDia(fecha);
    if (!delDia.length && !dePenas.length) continue;

    let t = `— ${formatDateSpanish(fecha)} —\n`;

    if (delDia.length) {
      for (const p of encargos.totalesDelDia(fecha)) {
        t += `   ${p.cantidad} × ${p.producto}\n`;
        // La indicación del obrador va aquí porque cambia cómo se hace.
        for (const n of p.notas) t += `        ⚠️ ${n}\n`;
      }
      const conRecogida = delDia.filter(e => e.notaRecogida);
      for (const e of conRecogida) t += `        · ${e.nombre}: ${e.notaRecogida}\n`;
    }

    if (dePenas.length) {
      t += `   🎪 peñas:\n`;
      for (const x of dePenas) t += `      ${x.cantidad} × ${x.producto}\n`;
    }
    bloques.push(t);
  }

  if (!bloques.length) {
    return `📋 Pedidos extra — próximos ${DIAS_VISTA} días\n\nNo hay nada fuera de lo habitual.`;
  }

  let txt = `📋 PEDIDOS EXTRA — próximos ${DIAS_VISTA} días\n`;
  txt += '(encargos y peñas, aparte de la producción de siempre)\n\n';
  txt += bloques.join('\n');
  txt += '\n👉 Comprobad que hay ingredientes para todo esto.';
  return txt;
}

export async function avisar(telegram: Telegram): Promise<string> {
  const hoy = format(toZonedTime(new Date(), config.timezone), 'yyyy-MM-dd', { timeZone: config.timezone });
  const texto = construirTexto(hoy);

  const destinos = [...new Set([config.extrasChatId, ...config.adminTelegramIds].filter(Boolean))];
  for (const chatId of destinos) {
    try {
      for (let i = 0; i < texto.length; i += 3900) {
        await telegram.sendMessage(chatId, texto.slice(i, i + 3900));
      }
    } catch (err) {
      error('ExtrasJob', `No se pudo avisar a ${chatId}: ${(err as Error).message}`);
    }
  }
  log('ExtrasJob', `Aviso enviado a ${destinos.length} chat(s)`);
  return texto;
}
