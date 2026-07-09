"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduleProductionSummary = scheduleProductionSummary;
const config_1 = require("../config");
const notifier_1 = require("../services/notifier");
const productionSummary_1 = require("../services/productionSummary");
const logger_1 = require("../utils/logger");
const date_fns_tz_1 = require("date-fns-tz");
// Envía el resumen de producción para el día siguiente a las 22:00 (hora de cierre de pedidos)
function scheduleProductionSummary(bot) {
    (0, notifier_1.initNotifier)(bot.telegram);
    let lastSentDate = '';
    setInterval(async () => {
        const now = (0, date_fns_tz_1.toZonedTime)(new Date(), config_1.config.timezone);
        const currentHour = now.getHours();
        const today = (0, date_fns_tz_1.format)(now, 'yyyy-MM-dd', { timeZone: config_1.config.timezone });
        if (currentHour === config_1.config.autoCutoffHour && lastSentDate !== today) {
            lastSentDate = today;
            // Calcular día siguiente
            const tomorrow = new Date(now);
            tomorrow.setDate(tomorrow.getDate() + 1);
            const tomorrowStr = (0, date_fns_tz_1.format)(tomorrow, 'yyyy-MM-dd', { timeZone: config_1.config.timezone });
            const tomorrowDow = tomorrow.getDay(); // 0=Dom…6=Sáb
            try {
                const text = await (0, productionSummary_1.buildProductionSummary)(tomorrowStr, tomorrowDow);
                await (0, notifier_1.sendToAdmin)(text);
                (0, logger_1.log)('ProductionSummaryJob', `Resumen de producción enviado para ${tomorrowStr}`);
            }
            catch (err) {
                (0, logger_1.warn)('ProductionSummaryJob', `Error: ${err.message}`);
            }
        }
    }, 60000);
    (0, logger_1.log)('ProductionSummaryJob', `Resumen de producción programado a las ${config_1.config.autoCutoffHour}:00 (${config_1.config.timezone})`);
}
//# sourceMappingURL=productionSummaryJob.js.map