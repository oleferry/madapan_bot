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
exports.notifyInternal = notifyInternal;
exports.sendDailySummary = sendDailySummary;
const fs = __importStar(require("fs"));
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
const dates_1 = require("../utils/dates");
async function notifyInternal(bot, message) {
    if (!config_1.config.telegramInternalChatId)
        return;
    try {
        await bot.telegram.sendMessage(config_1.config.telegramInternalChatId, message);
    }
    catch (err) {
        (0, logger_1.warn)('InternalFlows', `Failed to notify internal chat: ${err.message}`);
    }
}
async function sendDailySummary(bot, date) {
    if (!config_1.config.telegramInternalChatId)
        return;
    const logPath = config_1.config.logPath;
    if (!fs.existsSync(logPath)) {
        (0, logger_1.log)('InternalFlows', 'No log file found for daily summary');
        return;
    }
    const raw = fs.readFileSync(logPath, 'utf-8');
    const lines = raw
        .split('\n')
        .filter(Boolean)
        .map((l) => {
        try {
            return JSON.parse(l);
        }
        catch {
            return null;
        }
    })
        .filter((e) => e !== null && e.timestamp.startsWith(date));
    if (lines.length === 0) {
        await notifyInternal(bot, `Resumen ${(0, dates_1.formatDateSpanish)(date)}: sin cambios.`);
        return;
    }
    // Group by product
    const byProduct = {};
    const byClient = {};
    for (const entry of lines) {
        const pk = entry.sku || entry.productName;
        if (!byProduct[pk]) {
            byProduct[pk] = { name: entry.productName, delta: 0, count: 0 };
        }
        byProduct[pk].delta += entry.delta;
        byProduct[pk].count += 1;
        const ck = entry.telegramId;
        if (!byClient[ck]) {
            byClient[ck] = { name: entry.customerName, count: 0 };
        }
        byClient[ck].count += 1;
    }
    let msg = `Resumen ${(0, dates_1.formatDateSpanish)(date)} — ${lines.length} cambios\n\n`;
    msg += `Por producto:\n`;
    for (const p of Object.values(byProduct)) {
        const sign = p.delta >= 0 ? '+' : '';
        msg += `• ${p.name}: ${sign}${p.delta} uds (${p.count} cambios)\n`;
    }
    msg += `\nPor cliente:\n`;
    for (const c of Object.values(byClient)) {
        msg += `• ${c.name}: ${c.count} cambios\n`;
    }
    await notifyInternal(bot, msg);
}
//# sourceMappingURL=internalFlows.js.map