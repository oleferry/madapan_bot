"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initNotifier = initNotifier;
exports.sendToAdmin = sendToAdmin;
exports.sendAlert = sendAlert;
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
let telegramApi = null;
function initNotifier(telegram) {
    telegramApi = telegram;
}
// Resumen diario → solo al chat principal de Madapan
async function sendToAdmin(text) {
    const chatId = config_1.config.telegramInternalChatId;
    if (!chatId) {
        (0, logger_1.warn)('Notifier', 'TELEGRAM_INTERNAL_CHAT_ID no configurado — mensaje no enviado');
        return;
    }
    await sendMessage(chatId, text);
}
// Alertas urgentes → al chat principal + todos los IDs de TELEGRAM_ALERT_CHAT_IDS
async function sendAlert(text) {
    const targets = new Set();
    if (config_1.config.telegramInternalChatId)
        targets.add(config_1.config.telegramInternalChatId);
    for (const id of config_1.config.telegramAlertChatIds)
        targets.add(id);
    if (targets.size === 0) {
        (0, logger_1.warn)('Notifier', 'Ningún chat configurado para alertas');
        return;
    }
    await Promise.all([...targets].map(id => sendMessage(id, text)));
}
async function sendMessage(chatId, text) {
    if (!telegramApi) {
        (0, logger_1.warn)('Notifier', 'Notifier no inicializado');
        return;
    }
    try {
        await telegramApi.sendMessage(chatId, text);
        (0, logger_1.log)('Notifier', `Mensaje enviado a ${chatId}: ${text.slice(0, 60)}`);
    }
    catch (err) {
        (0, logger_1.warn)('Notifier', `Error enviando a ${chatId}: ${err.message}`);
    }
}
//# sourceMappingURL=notifier.js.map