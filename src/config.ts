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
  // Chat de destino de los albaranes diarios. Si no se define, cae en el chat
  // interno general (telegramInternalChatId).
  waybillsChatId: process.env['WAYBILLS_CHAT_ID'] ?? process.env['TELEGRAM_INTERNAL_CHAT_ID'] ?? '',
  telegramAlertChatIds: (process.env['TELEGRAM_ALERT_CHAT_IDS'] ?? '')
    .split(',').map(s => s.trim()).filter(Boolean),
  adminTelegramIds: (process.env['ADMIN_TELEGRAM_IDS'] ?? '')
    .split(',').map(s => s.trim()).filter(Boolean),
  // Google Sheets — hoja maestra de pedidos semanales.
  // En Railway la credencial va como variable de entorno (el JSON entero en una
  // línea); en local basta con dejar el fichero y apuntar GOOGLE_KEY_FILE.
  googleServiceAccountB64: process.env['GOOGLE_SERVICE_ACCOUNT_B64'] ?? '',
  googleServiceAccountJson: process.env['GOOGLE_SERVICE_ACCOUNT_JSON'] ?? '',
  googleKeyFile: process.env['GOOGLE_KEY_FILE'] ?? '',
  masterSheetId: process.env['MASTER_SHEET_ID'] ?? '',
  // Día y hora de la carga semanal (5 = viernes)
  weeklyOrdersDow: parseInt(process.env['WEEKLY_ORDERS_DOW'] ?? '5', 10),
  weeklyOrdersHour: parseInt(process.env['WEEKLY_ORDERS_HOUR'] ?? '10', 10),
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
  pizzaExtraDatesPath: process.env['PIZZA_EXTRA_DATES_PATH'] ?? persistPath('pizza-extra-dates.json', 'data/pizza-extra-dates.json'),
  waybillMapPath: process.env['WAYBILL_MAP_PATH'] ?? persistPath('waybill-map.json', 'data/waybill-map.json'),
  encargosPath: process.env['ENCARGOS_PATH'] ?? persistPath('encargos.json', 'data/encargos.json'),
  comprasPath: process.env['COMPRAS_PATH'] ?? persistPath('compras.json', 'data/compras.json'),
  // Día de la semana del borrador de pedidos a proveedor (3 = miércoles).
  // El borrador es quincenal; el job mira si han pasado 13 días.
  comprasDow: parseInt(process.env['COMPRAS_DOW'] ?? '3', 10),
  comprasHour: parseInt(process.env['COMPRAS_HOUR'] ?? '9', 10),
  // Facturas de proveedor: extracción con Claude y archivo en Drive.
  anthropicApiKey: process.env['ANTHROPIC_API_KEY'] ?? '',
  // OAuth de usuario, no cuenta de servicio: una cuenta de servicio no puede
  // escribir en "Mi unidad" de una cuenta Gmail normal (solo en unidades
  // compartidas). Ver docs/credenciales-facturas.md.
  googleOauthClientId: process.env['GOOGLE_OAUTH_CLIENT_ID'] ?? '',
  googleOauthClientSecret: process.env['GOOGLE_OAUTH_CLIENT_SECRET'] ?? '',
  googleOauthRefreshToken: process.env['GOOGLE_OAUTH_REFRESH_TOKEN'] ?? '',
  // Carpeta .../Contabilidad/Facturas/Recibidas. Se fija por ID porque hay
  // tres carpetas llamadas "Recibidas" en el Drive y buscarlas por nombre
  // acierta la que no es.
  driveFacturasFolderId: process.env['DRIVE_FACTURAS_FOLDER_ID'] ?? '',
  driveAlbaranesFolderId: process.env['DRIVE_ALBARANES_FOLDER_ID'] ?? '',
  // Remitente del envío a Holded por la API de Gmail. Railway bloquea el SMTP
  // saliente (587 y 465 dan ETIMEDOUT), así que el correo sale por HTTPS.
  gmailRemitente: process.env['GMAIL_REMITENTE'] ?? '',
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
