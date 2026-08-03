import { Telegraf, Telegram } from 'telegraf';
import { toZonedTime, format } from 'date-fns-tz';
import { config } from '../config';
import * as weeklyOrders from '../services/weeklyOrdersService';
import * as sheetsClient from '../services/sheetsClient';
import { log, warn } from '../utils/logger';

// Pedidos preparados a la espera de que un admin confirme desde Telegram.
// Se guarda en memoria: si el bot se reinicia, se vuelve a lanzar la
// preparación y no se crea nada sin confirmación, que es lo seguro.
let pendiente: { orders: weeklyOrders.WeeklyOrder[]; lunes: string } | null = null;

export function hayPendiente(): boolean {
  return pendiente !== null;
}

function resumen(orders: weeklyOrders.WeeklyOrder[]): string {
  const lineas = orders.reduce((s, o) => s + o.lines.length, 0);
  const total = orders.reduce(
    (s, o) => s + o.lines.reduce((t, l) => t + l.units * l.price * (1 - l.discount / 100), 0),
    0
  );
  const dias = [...new Set(orders.map(o => o.fecha))].sort();
  return `${orders.length} pedidos · ${lineas} líneas · ${total.toFixed(2)} € (sin IVA)\n` +
    `Del ${dias[0]} al ${dias[dias.length - 1]}`;
}

// Paso 1: fija el lunes en la hoja, lee los pedidos y pide confirmación.
export async function prepararCargaSemanal(telegram: Telegram, chatId: string): Promise<void> {
  if (!sheetsClient.isConfigured()) {
    await telegram.sendMessage(chatId, '⚠️ Falta configurar el acceso a Google Sheets (GOOGLE_SERVICE_ACCOUNT_JSON y MASTER_SHEET_ID).');
    return;
  }

  const ahora = toZonedTime(new Date(), config.timezone);
  const lunes = weeklyOrders.nextMonday(ahora);

  await telegram.sendMessage(chatId, `📋 Preparando la carga de la semana del ${lunes}...`);

  await weeklyOrders.setWeekMonday(lunes);
  // La hoja recalcula en el servidor, pero damos margen antes de leer.
  await new Promise(r => setTimeout(r, 5000));

  const { orders, problemas } = await weeklyOrders.readWeeklyOrders();

  if (problemas.length > 0) {
    pendiente = null;
    const lista = problemas.slice(0, 15).map(p => `• ${p}`).join('\n');
    const mas = problemas.length > 15 ? `\n…y ${problemas.length - 15} más` : '';
    await telegram.sendMessage(
      chatId,
      `❌ No se ha cargado nada.\n\nLa hoja tiene ${problemas.length} problema(s):\n${lista}${mas}\n\n` +
      `Corrige la hoja y vuelve a lanzarlo con /cargar_semana.`
    );
    return;
  }

  pendiente = { orders, lunes };
  await telegram.sendMessage(
    chatId,
    `📋 Semana del ${lunes}\n\n${resumen(orders)}\n\n¿Creo estos pedidos en Holded?`,
    {
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Sí, crear', callback_data: 'cs_ok' },
          { text: '❌ Cancelar', callback_data: 'cs_no' },
        ]],
      },
    }
  );
}

// Paso 2: crea de verdad los pedidos en Holded.
export async function confirmarCargaSemanal(telegram: Telegram, chatId: string): Promise<void> {
  if (!pendiente) {
    await telegram.sendMessage(chatId, 'No hay ninguna carga preparada. Lanza /cargar_semana primero.');
    return;
  }
  const { orders, lunes } = pendiente;
  pendiente = null; // evita doble confirmación

  await telegram.sendMessage(chatId, `Creando ${orders.length} pedidos en Holded... (puede tardar un par de minutos)`);

  const r = await weeklyOrders.createOrdersInHolded(orders);

  let txt = `✅ Semana del ${lunes} cargada\n\n` +
    `Creados: ${r.creados}\nOmitidos (ya existían): ${r.omitidos}\nFallidos: ${r.fallidos.length}`;
  if (r.fallidos.length > 0) {
    txt += '\n\n' + r.fallidos.slice(0, 10).map(f => `• ${f.numPedido}: ${f.motivo}`).join('\n');
    if (r.fallidos.length > 10) txt += `\n…y ${r.fallidos.length - 10} más`;
  }
  await telegram.sendMessage(chatId, txt);
}

export function cancelarCargaSemanal(): void {
  pendiente = null;
}

// Programa la preparación automática los viernes. Nunca crea nada solo:
// siempre deja la confirmación en manos de un admin.
export function scheduleWeeklyOrders(bot: Telegraf): void {
  const chatId = config.telegramInternalChatId;
  if (!chatId) {
    warn('WeeklyOrdersJob', 'TELEGRAM_INTERNAL_CHAT_ID no configurado — no se programa la carga semanal');
    return;
  }

  let ultimoLanzado = '';

  setInterval(async () => {
    const ahora = toZonedTime(new Date(), config.timezone);
    const hoy = format(ahora, 'yyyy-MM-dd', { timeZone: config.timezone });

    if (
      ahora.getDay() === config.weeklyOrdersDow &&
      ahora.getHours() === config.weeklyOrdersHour &&
      ultimoLanzado !== hoy
    ) {
      ultimoLanzado = hoy;
      try {
        await prepararCargaSemanal(bot.telegram, chatId);
      } catch (err) {
        warn('WeeklyOrdersJob', `Error: ${(err as Error).message}`);
        await bot.telegram.sendMessage(chatId, `⚠️ Error preparando la carga semanal: ${(err as Error).message}`);
      }
    }
  }, 60_000);

  log('WeeklyOrdersJob', `Carga semanal programada: día ${config.weeklyOrdersDow} a las ${config.weeklyOrdersHour}:00`);
}
