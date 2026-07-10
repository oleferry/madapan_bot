import dotenv from 'dotenv';
import * as path from 'path';
dotenv.config();

// Directorio para los datos mutables (pedidos, stock, caché, logs). En Railway
// se apunta al volumen persistente vía DATA_DIR (o RAILWAY_VOLUME_MOUNT_PATH),
// para que no se pierdan en cada despliegue. Sin definir, se usan las rutas
// locales de siempre (data/ y logs/).
const dataDir = process.env['DATA_DIR'] ?? process.env['RAILWAY_VOLUME_MOUNT_PATH'] ?? '';
const persistPath = (fileName: string, legacy: string): string =>
  dataDir ? path.join(dataDir, fileName) : legacy;

export const config = {
  telegramBotToken: process.env['TELEGRAM_BOT_TOKEN'] ?? '',
  telegramInternalChatId: process.env['TELEGRAM_INTERNAL_CHAT_ID'] ?? '',
  telegramAlertChatIds: (process.env['TELEGRAM_ALERT_CHAT_IDS'] ?? '')
    .split(',').map(s => s.trim()).filter(Boolean),
  adminTelegramIds: (process.env['ADMIN_TELEGRAM_IDS'] ?? '')
    .split(',').map(s => s.trim()).filter(Boolean),
  holdedApiKey: process.env['HOLDED_API_KEY'] ?? '',
  holdedApiKeyV1: process.env['HOLDED_API_KEY_V1'] ?? '',
  holdedApiBaseUrl: process.env['HOLDED_API_BASE_URL'] ?? 'https://api.holded.com/api/v2',
  holdedApiV1Url: 'https://api.holded.com/api/invoicing/v1',
  holdedContactsUrl: process.env['HOLDED_CONTACTS_URL'] ?? 'https://api.holded.com/api/v2',
  privacyPolicyUrl: process.env['PRIVACY_POLICY_URL'] ?? 'https://www.madapan.es/privacidad',
  timezone: process.env['TIMEZONE'] ?? 'Europe/Madrid',
  autoCutoffHour: parseInt(process.env['AUTO_CHANGE_LIMIT_HOUR'] ?? '20', 10),
  dailySummaryHour: parseInt(process.env['DAILY_SUMMARY_HOUR'] ?? '0', 10),
  waybillsJobHour: parseInt(process.env['WAYBILLS_JOB_HOUR'] ?? '6', 10),
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  dryRun: process.env['DRY_RUN'] === 'true',
  clientsCachePath: process.env['CLIENTS_CACHE_PATH'] ?? persistPath('clients.json', 'data/clients.json'),
  logPath: process.env['LOG_PATH'] ?? persistPath('changes.log', 'logs/changes.log'),
  pizzaOrdersLogPath: process.env['PIZZA_ORDERS_LOG_PATH'] ?? persistPath('pizza-orders.log', 'logs/pizza-orders.log'),
  pizzaStockPath: process.env['PIZZA_STOCK_PATH'] ?? persistPath('pizza-stock.json', 'data/pizza-stock.json'),
  waybillMapPath: process.env['WAYBILL_MAP_PATH'] ?? persistPath('waybill-map.json', 'data/waybill-map.json'),
};

export const isDryRun = config.dryRun;

const isTest = config.nodeEnv === 'test';

if (!isTest) {
  if (!config.telegramBotToken) {
    throw new Error('Missing required environment variable: TELEGRAM_BOT_TOKEN');
  }
  if (!config.holdedApiKey) {
    throw new Error('Missing required environment variable: HOLDED_API_KEY');
  }
}
