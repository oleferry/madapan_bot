import { Telegram } from 'telegraf';
import { config } from '../config';
import { warn, log } from '../utils/logger';

let telegramApi: Telegram | null = null;

export function initNotifier(telegram: Telegram): void {
  telegramApi = telegram;
}

// Resumen diario → solo al chat principal de Madapan
export async function sendToAdmin(text: string): Promise<void> {
  const chatId = config.telegramInternalChatId;
  if (!chatId) {
    warn('Notifier', 'TELEGRAM_INTERNAL_CHAT_ID no configurado — mensaje no enviado');
    return;
  }
  await sendMessage(chatId, text);
}

// Notificaciones a todo el staff (p.ej. nueva reserva de pizza) → a cada
// teléfono marcado como admin en ADMIN_TELEGRAM_IDS.
export async function sendToAllStaff(text: string): Promise<void> {
  const targets = config.adminTelegramIds;
  if (targets.length === 0) {
    warn('Notifier', 'ADMIN_TELEGRAM_IDS no configurado — mensaje no enviado a staff');
    return;
  }
  await Promise.all(targets.map(id => sendMessage(id, text)));
}

// Alertas urgentes → al chat principal + todos los IDs de TELEGRAM_ALERT_CHAT_IDS
export async function sendAlert(text: string): Promise<void> {
  const targets = new Set<string>();
  if (config.telegramInternalChatId) targets.add(config.telegramInternalChatId);
  for (const id of config.telegramAlertChatIds) targets.add(id);

  if (targets.size === 0) {
    warn('Notifier', 'Ningún chat configurado para alertas');
    return;
  }

  await Promise.all([...targets].map(id => sendMessage(id, text)));
}

async function sendMessage(chatId: string, text: string): Promise<void> {
  if (!telegramApi) {
    warn('Notifier', 'Notifier no inicializado');
    return;
  }
  try {
    await telegramApi.sendMessage(chatId, text);
    log('Notifier', `Mensaje enviado a ${chatId}: ${text.slice(0, 60)}`);
  } catch (err) {
    warn('Notifier', `Error enviando a ${chatId}: ${(err as Error).message}`);
  }
}
