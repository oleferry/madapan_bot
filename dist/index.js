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
require("dotenv/config");
const config_1 = require("./config");
const clientCache_1 = require("./services/clientCache");
const telegramBot_1 = require("./bot/telegramBot");
const dailySummaryJob_1 = require("./jobs/dailySummaryJob");
const productionSummaryJob_1 = require("./jobs/productionSummaryJob");
const logger_1 = require("./utils/logger");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
async function main() {
    // Ensure dirs exist
    fs.mkdirSync(path.dirname(config_1.config.logPath), { recursive: true });
    fs.mkdirSync(path.dirname(config_1.config.clientsCachePath), { recursive: true });
    (0, clientCache_1.loadCache)();
    const bot = await (0, telegramBot_1.launchBot)();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (0, dailySummaryJob_1.scheduleDailySummary)(bot);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (0, productionSummaryJob_1.scheduleProductionSummary)(bot);
    (0, logger_1.log)('main', `Bot started. DRY_RUN=${config_1.config.dryRun}`);
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
main().catch(console.error);
//# sourceMappingURL=index.js.map