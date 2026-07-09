"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.readTodayChanges = readTodayChanges;
exports.buildSummaryText = buildSummaryText;
exports.scheduleDailySummary = scheduleDailySummary;
const fs = __importStar(require("fs"));
const config_1 = require("../config");
const notifier_1 = require("../services/notifier");
const logger_1 = require("../utils/logger");
const date_fns_tz_1 = require("date-fns-tz");
function todayInMadrid() {
    const now = (0, date_fns_tz_1.toZonedTime)(new Date(), config_1.config.timezone);
    return (0, date_fns_tz_1.format)(now, 'yyyy-MM-dd', { timeZone: config_1.config.timezone });
}
function readTodayChanges() {
    const today = todayInMadrid();
    try {
        if (!fs.existsSync(config_1.config.logPath))
            return [];
        const lines = fs.readFileSync(config_1.config.logPath, 'utf-8').split('\n').filter(Boolean);
        return lines
            .map(l => {
            try {
                return JSON.parse(l);
            }
            catch {
                return null;
            }
        })
            .filter((e) => e !== null && e.timestamp.startsWith(today));
    }
    catch (err) {
        (0, logger_1.warn)('DailySummaryJob', `Error leyendo log: ${err.message}`);
        return [];
    }
}
function buildSummaryText(entries, today) {
    if (entries.length === 0) {
        return `📋 Resumen de cambios — ${today}\n\nNo hubo cambios en los pedidos hoy.`;
    }
    const byClient = new Map();
    for (const e of entries) {
        if (!byClient.has(e.customerName))
            byClient.set(e.customerName, []);
        byClient.get(e.customerName).push(e);
    }
    let text = `📋 Resumen de cambios — ${today}\n`;
    text += `Total: ${entries.length} cambio(s) en ${byClient.size} cliente(s)\n`;
    if (config_1.config.dryRun)
        text += `⚠️ MODO SIMULACIÓN ACTIVO\n`;
    text += '\n';
    for (const [clientName, changes] of byClient) {
        text += `👤 ${clientName}\n`;
        for (const c of changes) {
            const hora = (0, date_fns_tz_1.format)((0, date_fns_tz_1.toZonedTime)(new Date(c.timestamp), config_1.config.timezone), 'HH:mm', { timeZone: config_1.config.timezone });
            const signo = c.delta > 0 ? '+' : '';
            text += `  • ${c.productName}: ${c.previousUnits} → ${c.newUnits} uds (${signo}${c.delta}) a las ${hora}\n`;
        }
    }
    return text.trim();
}
function scheduleDailySummary(bot) {
    (0, notifier_1.initNotifier)(bot.telegram);
    let lastSentDate = '';
    setInterval(() => {
        const now = (0, date_fns_tz_1.toZonedTime)(new Date(), config_1.config.timezone);
        const currentHour = now.getHours();
        const today = (0, date_fns_tz_1.format)(now, 'yyyy-MM-dd', { timeZone: config_1.config.timezone });
        if (currentHour === config_1.config.dailySummaryHour && lastSentDate !== today) {
            lastSentDate = today;
            const entries = readTodayChanges();
            const text = buildSummaryText(entries, today);
            (0, notifier_1.sendToAdmin)(text).catch(err => (0, logger_1.warn)('DailySummaryJob', `Error enviando resumen: ${err.message}`));
            (0, logger_1.log)('DailySummaryJob', `Resumen diario enviado para ${today} (${entries.length} cambios)`);
        }
    }, 60000);
    (0, logger_1.log)('DailySummaryJob', `Resumen diario programado a las ${config_1.config.dailySummaryHour}:00 (${config_1.config.timezone})`);
}
//# sourceMappingURL=dailySummaryJob.js.map