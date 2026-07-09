"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isDryRun = exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.config = {
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
    nodeEnv: process.env['NODE_ENV'] ?? 'development',
    dryRun: process.env['DRY_RUN'] === 'true',
    clientsCachePath: process.env['CLIENTS_CACHE_PATH'] ?? 'data/clients.json',
    logPath: process.env['LOG_PATH'] ?? 'logs/changes.log',
};
exports.isDryRun = exports.config.dryRun;
const isTest = exports.config.nodeEnv === 'test';
if (!isTest) {
    if (!exports.config.telegramBotToken) {
        throw new Error('Missing required environment variable: TELEGRAM_BOT_TOKEN');
    }
    if (!exports.config.holdedApiKey) {
        throw new Error('Missing required environment variable: HOLDED_API_KEY');
    }
}
//# sourceMappingURL=config.js.map