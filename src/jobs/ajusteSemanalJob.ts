import cron from 'node-cron';
import { Telegraf, Markup, Telegram } from 'telegraf';
import { toZonedTime, format } from 'date-fns-tz';
import * as historico from '../services/historicoVentas';
import * as ps from '../services/pedidosSemanaService';
import * as aj from '../services/ajusteSemanalService';
import { config } from '../config';
import { log, error } from '../utils/logger';

// Revisión semanal de los albaranes: cuánto se sirvió, cuánto volvió, y qué
// cantidad tocaría poner en la hoja.
//
// Corre el día ANTERIOR a la carga semanal para que dé tiempo a revisarlo y
// aplicarlo antes de que los pedidos suban a Holded.
//
// No escribe nada por su cuenta: manda la propuesta con un botón.

// Solo las últimas semanas: lo de hace medio año no dice nada de lo que se
// vende hoy, y un cliente que cambió de hábitos quedaría lastrado por su
// propio pasado.
const SEMANAS = 6;

let propuesta: { cambios: ps.Cambio[]; generadaEl: string } | null = null;

export function scheduleAjusteSemanal(bot: Telegraf<never>): void {
  const dia = (config.weeklyOrdersDow + 6) % 7;      // el día antes de cargar
  cron.schedule(`0 ${config.comprasHour} * * ${dia}`, () => void revisarYAvisar(bot.telegram),
    { timezone: config.timezone });
  log('AjusteSemanalJob', `Revisión de albaranes programada: día ${dia} a las ${config.comprasHour}:00`);
}

// Recibe el "telegram" y no el bot entero: así vale igual desde el cron que
// desde un comando, donde solo hay ctx.telegram.
export async function revisarYAvisar(telegram: Telegram): Promise<string> {
  const hoy = format(toZonedTime(new Date(), config.timezone), 'yyyy-MM-dd', { timeZone: config.timezone });
  const desde = new Date(`${hoy}T12:00:00Z`);
  desde.setUTCDate(desde.getUTCDate() - SEMANAS * 7);

  // Se fuerza la descarga: la revisión tiene que mirar los albaranes de esta
  // semana, no una caché de hace días.
  const entregas = await historico.cargar(true);
  const filas = await ps.leer();
  const { revisiones, cambios, bruscos } = aj.revisar(entregas, filas, {
    desde: desde.toISOString().slice(0, 10),
  });

  propuesta = cambios.length ? { cambios, generadaEl: hoy } : null;
  const texto = aj.textoRevision(revisiones, cambios, bruscos);

  for (const chatId of config.adminTelegramIds) {
    try {
      for (let i = 0; i < texto.length; i += 3900) {
        await telegram.sendMessage(chatId, texto.slice(i, i + 3900));
      }
      if (cambios.length) {
        await telegram.sendMessage(chatId,
          `¿Aplico los ${cambios.length} cambios en Pedidos_semana?`,
          Markup.inlineKeyboard([
            [Markup.button.callback('✅ Aplicar', 'aj_aplicar')],
            [Markup.button.callback('✖️ Dejarlo', 'aj_no')],
          ]));
      }
    } catch (err) {
      error('AjusteSemanalJob', `No se pudo avisar a ${chatId}: ${(err as Error).message}`);
    }
  }
  return texto;
}

export function propuestaPendiente(): ps.Cambio[] {
  return propuesta?.cambios ?? [];
}

export function descartarPropuesta(): void {
  propuesta = null;
}
