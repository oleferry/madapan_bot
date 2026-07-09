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
exports.createBot = createBot;
exports.launchBot = launchBot;
const telegraf_1 = require("telegraf");
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
const customerFlows_1 = require("./customerFlows");
const pizzaFlow_1 = require("./pizzaFlow");
const pizzaService = __importStar(require("../services/pizzaService"));
function isStaff(ctx) {
    return config_1.config.adminTelegramIds.includes(String(ctx.from?.id ?? ''));
}
async function sendResumen(ctx) {
    const { toZonedTime, format } = await Promise.resolve().then(() => __importStar(require('date-fns-tz')));
    const { readTodayChanges, buildSummaryText } = await Promise.resolve().then(() => __importStar(require('../jobs/dailySummaryJob')));
    const now = toZonedTime(new Date(), config_1.config.timezone);
    const today = format(now, 'yyyy-MM-dd', { timeZone: config_1.config.timezone });
    const entries = readTodayChanges();
    await ctx.reply(buildSummaryText(entries, today));
}
async function sendProduccion(ctx) {
    const { getRelevantProductionDate, getDayOfWeek } = await Promise.resolve().then(() => __importStar(require('../utils/dates')));
    const { buildProductionSummary } = await Promise.resolve().then(() => __importStar(require('../services/productionSummary')));
    const dateStr = getRelevantProductionDate();
    await ctx.reply('Calculando producción...');
    const text = await buildProductionSummary(dateStr, getDayOfWeek(dateStr));
    await ctx.reply(text);
}
async function sendResumenYProduccion(ctx) {
    const { getRelevantProductionDate, getDayOfWeek, formatDateSpanish } = await Promise.resolve().then(() => __importStar(require('../utils/dates')));
    const { buildProductionSummary } = await Promise.resolve().then(() => __importStar(require('../services/productionSummary')));
    const { toZonedTime, format } = await Promise.resolve().then(() => __importStar(require('date-fns-tz')));
    const { readTodayChanges, buildSummaryText } = await Promise.resolve().then(() => __importStar(require('../jobs/dailySummaryJob')));
    const dateStr = getRelevantProductionDate();
    const now = toZonedTime(new Date(), config_1.config.timezone);
    const today = format(now, 'yyyy-MM-dd', { timeZone: config_1.config.timezone });
    await ctx.reply(`Calculando resumen y producción para ${formatDateSpanish(dateStr)}...`);
    const entries = readTodayChanges();
    const resumenText = buildSummaryText(entries, today);
    const produccionText = await buildProductionSummary(dateStr, getDayOfWeek(dateStr));
    await ctx.reply(`${resumenText}\n\n──────────\n\n${produccionText}`);
}
function createBot() {
    const bot = new telegraf_1.Telegraf(config_1.config.telegramBotToken);
    // Session middleware
    bot.use((0, telegraf_1.session)({
        defaultSession: () => ({ step: 'idle' }),
    }));
    // ── Commands ────────────────────────────────────────────────────────────────
    bot.start(async (ctx) => {
        // Deep link t.me/<bot>?start=pizza → entra directo al flujo de reserva de pizza
        const payload = ctx.startPayload;
        if (payload === 'pizza') {
            await (0, pizzaFlow_1.handlePizzaStart)(ctx);
            return;
        }
        await (0, customerFlows_1.handleStart)(ctx);
    });
    bot.command('hola', customerFlows_1.handleStart);
    // Comando para obtener el chat ID (para configurar ADMIN_TELEGRAM_IDS)
    bot.command('admin', async (ctx) => {
        const chatId = ctx.chat.id;
        await ctx.reply(`Tu chat ID es: ${chatId}\n\nPara darte acceso de staff, añádelo a ADMIN_TELEGRAM_IDS en Railway.`);
    });
    // Resumen de producción bajo demanda (staff — cualquier admin)
    bot.command('produccion', async (ctx) => {
        if (!isStaff(ctx))
            return;
        await sendProduccion(ctx);
    });
    // Resumen de cambios bajo demanda (staff — cualquier admin)
    bot.command('resumen', async (ctx) => {
        if (!isStaff(ctx))
            return;
        await sendResumen(ctx);
    });
    // Resumen + producción combinados, en un solo comando (staff — cualquier admin)
    bot.command('resumen_produccion', async (ctx) => {
        if (!isStaff(ctx))
            return;
        await sendResumenYProduccion(ctx);
    });
    // Pizzas — reserva pública, abierta a cualquier usuario
    bot.command('pizza', pizzaFlow_1.handlePizzaStart);
    // Admin: fija el stock de pizzas disponibles para el finde en curso
    bot.command('pizzas_stock', async (ctx) => {
        if (!isStaff(ctx))
            return;
        const arg = ctx.message.text.split(' ')[1];
        const n = parseInt(arg ?? '', 10);
        if (isNaN(n) || n < 0) {
            await ctx.reply('Uso: /pizzas_stock <número de unidades>\nEjemplo: /pizzas_stock 40');
            return;
        }
        pizzaService.setWeekendStock(n);
        await ctx.reply(`✅ Stock de pizzas fijado a ${n} unidades para este fin de semana.`);
    });
    // Admin: resumen de reservas de pizza del finde en curso
    bot.command('pedidos_pizzas', async (ctx) => {
        if (!isStaff(ctx))
            return;
        await ctx.reply(pizzaService.buildPizzaOrdersSummary());
    });
    // Registrar comandos en el menú "/" nativo de Telegram.
    // Los comandos de staff se registran SOLO en el chat de cada admin, usando el
    // scope de Telegram, para que los clientes no los vean en su menú.
    const publicCommands = [
        { command: 'hola', description: 'Iniciar / menú principal' },
        { command: 'pizza', description: 'Reservar pizza de fin de semana' },
        { command: 'admin', description: 'Ver mi chat ID' },
    ];
    const staffCommands = [
        ...publicCommands,
        { command: 'resumen', description: 'Resumen de cambios de hoy (staff)' },
        { command: 'produccion', description: 'Producción del día (staff)' },
        { command: 'resumen_produccion', description: 'Resumen + producción juntos (staff)' },
        { command: 'pizzas_stock', description: 'Fijar stock de pizzas del finde (staff)' },
        { command: 'pedidos_pizzas', description: 'Ver reservas de pizza del finde (staff)' },
    ];
    // Comandos públicos → visibles para todos los usuarios (scope por defecto)
    bot.telegram.setMyCommands(publicCommands)
        .catch(err => (0, logger_1.warn)('TelegramBot', `setMyCommands (public) failed: ${err.message}`));
    // Comandos de staff → visibles solo en el chat de cada admin
    for (const adminId of config_1.config.adminTelegramIds) {
        const chatId = Number(adminId);
        if (Number.isNaN(chatId)) {
            (0, logger_1.warn)('TelegramBot', `ADMIN_TELEGRAM_IDS contiene un id no numérico: "${adminId}"`);
            continue;
        }
        bot.telegram.setMyCommands(staffCommands, { scope: { type: 'chat', chat_id: chatId } })
            .catch(err => (0, logger_1.warn)('TelegramBot', `setMyCommands (staff ${adminId}) failed: ${err.message}`));
    }
    // ── Contact ─────────────────────────────────────────────────────────────────
    bot.on('contact', customerFlows_1.handleContact);
    // ── Callback queries ─────────────────────────────────────────────────────────
    bot.on('callback_query', async (ctx) => {
        const cbQuery = ctx.callbackQuery;
        const data = cbQuery?.data ?? '';
        try {
            await ctx.answerCbQuery();
            if (data === 'main_menu') {
                await (0, customerFlows_1.handleMainMenu)(ctx);
                return;
            }
            // start_pizza — botón "Reservar pizza" del menú de bienvenida (público)
            if (data === 'start_pizza') {
                await (0, pizzaFlow_1.handlePizzaStart)(ctx);
                return;
            }
            // identify_client — botón "Ya soy cliente de Madapan" (identificación por DNI)
            if (data === 'identify_client') {
                await (0, customerFlows_1.handleIdentifyClient)(ctx);
                return;
            }
            if (data === 'view_tomorrow') {
                await (0, customerFlows_1.handleViewOrder)(ctx);
                return;
            }
            if (data === 'change_tomorrow') {
                const tomorrow = (await Promise.resolve().then(() => __importStar(require('../utils/dates')))).getTomorrowDate();
                await (0, customerFlows_1.handleChangeOrder)(ctx, tomorrow);
                return;
            }
            if (data === 'select_day') {
                await (0, customerFlows_1.handleDaySelection)(ctx);
                return;
            }
            if (data === 'contact_madapan') {
                await (0, customerFlows_1.handleContactMadapan)(ctx);
                return;
            }
            // day|YYYY-MM-DD
            if (data.startsWith('day|')) {
                const dateStr = data.split('|')[1];
                await (0, customerFlows_1.handleChangeOrder)(ctx, dateStr);
                return;
            }
            // change_order|dateStr
            if (data.startsWith('change_order|')) {
                const dateStr = data.split('|')[1];
                await (0, customerFlows_1.handleChangeOrder)(ctx, dateStr);
                return;
            }
            // product|lineIdx
            if (data.startsWith('product|')) {
                const lineIdx = parseInt(data.split('|')[1], 10);
                await (0, customerFlows_1.handleProductSelected)(ctx, lineIdx);
                return;
            }
            // d|lineIdx|delta
            if (data.startsWith('d|')) {
                const parts = data.split('|');
                const lineIdx = parseInt(parts[1], 10);
                const delta = parseInt(parts[2], 10);
                await (0, customerFlows_1.handleQuantityButton)(ctx, lineIdx, delta);
                return;
            }
            // exact|lineIdx
            if (data.startsWith('exact|')) {
                const lineIdx = parseInt(data.split('|')[1], 10);
                await (0, customerFlows_1.handleExactQuantity)(ctx, lineIdx);
                return;
            }
            // add_product|dateStr
            if (data.startsWith('add_product|')) {
                const dateStr = data.split('|')[1];
                await (0, customerFlows_1.handleShowAddProduct)(ctx, dateStr);
                return;
            }
            // ap|productCod  (add product - select)
            if (data.startsWith('ap|')) {
                const productCod = data.split('|')[1];
                await (0, customerFlows_1.handleAddProductSelected)(ctx, productCod);
                return;
            }
            // apq|productCod|units  (add product - quantity button)
            if (data.startsWith('apq|')) {
                const parts = data.split('|');
                const productCod = parts[1];
                const units = parseInt(parts[2], 10);
                await (0, customerFlows_1.handleAddProductQuantity)(ctx, productCod, units);
                return;
            }
            // apq_manual|productCod  (add product - manual quantity)
            if (data.startsWith('apq_manual|')) {
                const productCod = data.split('|')[1];
                await (0, customerFlows_1.handleAddProductSelected)(ctx, productCod);
                return;
            }
            // cancel_line|lineIdx — pedir confirmación
            if (data.startsWith('cancel_line|') && !data.startsWith('cancel_line_ok|')) {
                const lineIdx = parseInt(data.split('|')[1], 10);
                await (0, customerFlows_1.handleCancelLineConfirm)(ctx, lineIdx);
                return;
            }
            // cancel_line_ok|lineIdx — confirmar y ejecutar
            if (data.startsWith('cancel_line_ok|')) {
                const lineIdx = parseInt(data.split('|')[1], 10);
                await (0, customerFlows_1.handleCancelLine)(ctx, lineIdx);
                return;
            }
            // view_order|dateStr
            if (data.startsWith('view_order|')) {
                const dateStr = data.split('|')[1];
                await (0, customerFlows_1.handleViewOrder)(ctx, dateStr);
                return;
            }
            // order_history
            if (data === 'order_history') {
                await (0, customerFlows_1.handleOrderHistory)(ctx);
                return;
            }
            // Acciones de administrador — verificación de permisos (defensa en profundidad).
            // Estos botones solo se envían a admins, pero bloqueamos también el callback
            // por si alguien intentara dispararlo de forma fabricada.
            const adminCallbacks = [
                'admin_select_client', 'admin_by_nif',
                'admin_resumen_produccion', 'admin_resumen', 'admin_produccion',
                'admin_pizzas_stock', 'admin_pizzas_pedidos',
            ];
            if ((adminCallbacks.includes(data) || data.startsWith('acli|')) && !isStaff(ctx)) {
                (0, logger_1.warn)('TelegramBot', `Non-staff callback bloqueado: "${data}" from ${ctx.from?.id}`);
                return;
            }
            // admin_select_client
            if (data === 'admin_select_client') {
                await (0, customerFlows_1.handleAdminSelectClient)(ctx);
                return;
            }
            // admin_by_nif — buscar cliente escribiendo NIF
            if (data === 'admin_by_nif') {
                await (0, customerFlows_1.handleAdminByNif)(ctx);
                return;
            }
            // acli|NIF — cliente elegido del desplegable
            if (data.startsWith('acli|')) {
                const nif = data.split('|')[1];
                await (0, customerFlows_1.handleAdminClientChosen)(ctx, nif);
                return;
            }
            // admin_resumen_produccion — botón del menú admin (combinado)
            if (data === 'admin_resumen_produccion') {
                await sendResumenYProduccion(ctx);
                return;
            }
            // admin_resumen — botón del menú admin (solo resumen de cambios)
            if (data === 'admin_resumen') {
                await sendResumen(ctx);
                return;
            }
            // admin_produccion — botón del menú admin (solo producción)
            if (data === 'admin_produccion') {
                await sendProduccion(ctx);
                return;
            }
            // pz_tipo|individual|menu
            if (data.startsWith('pz_tipo|')) {
                const tipo = data.split('|')[1];
                await (0, pizzaFlow_1.handlePizzaTipoElegido)(ctx, tipo);
                return;
            }
            // pz_pizza|id
            if (data.startsWith('pz_pizza|')) {
                const pizzaId = data.split('|')[1];
                await (0, pizzaFlow_1.handlePizzaElegida)(ctx, pizzaId);
                return;
            }
            // pz_postre|numero|id
            if (data.startsWith('pz_postre|')) {
                const parts = data.split('|');
                await (0, pizzaFlow_1.handlePizzaPostreElegido)(ctx, parseInt(parts[1], 10), parts[2]);
                return;
            }
            // pz_cant|n
            if (data.startsWith('pz_cant|')) {
                await (0, pizzaFlow_1.handlePizzaCantidadElegida)(ctx, parseInt(data.split('|')[1], 10));
                return;
            }
            // pz_dia|Día
            if (data.startsWith('pz_dia|')) {
                await (0, pizzaFlow_1.handlePizzaDiaElegido)(ctx, data.split('|')[1]);
                return;
            }
            // pz_hora|HH:mm
            if (data.startsWith('pz_hora|')) {
                await (0, pizzaFlow_1.handlePizzaHoraElegida)(ctx, data.split('|')[1]);
                return;
            }
            // pz_promo|si|no — consentimiento de marketing (protección de datos)
            if (data.startsWith('pz_promo|')) {
                await (0, pizzaFlow_1.handlePizzaMarketing)(ctx, data.split('|')[1] === 'si');
                return;
            }
            // admin_pizzas_stock — botón del menú admin
            if (data === 'admin_pizzas_stock') {
                await (0, customerFlows_1.handleAdminPizzaStockPrompt)(ctx);
                return;
            }
            // admin_pizzas_pedidos — botón del menú admin
            if (data === 'admin_pizzas_pedidos') {
                await (0, customerFlows_1.handleAdminPizzaPedidos)(ctx);
                return;
            }
            (0, logger_1.warn)('TelegramBot', `Unhandled callback: ${data}`);
        }
        catch (err) {
            (0, logger_1.error)('TelegramBot', `Callback error for "${data}": ${err.message}`);
            try {
                await ctx.reply('Ha ocurrido un error. Por favor inténtalo de nuevo.');
            }
            catch {
                // ignore
            }
        }
    });
    // ── Text messages ───────────────────────────────────────────────────────────
    bot.on('text', async (ctx) => {
        const handledByPizza = await (0, pizzaFlow_1.handlePizzaText)(ctx);
        if (handledByPizza)
            return;
        await (0, customerFlows_1.handleText)(ctx);
    });
    // ── Error handler ───────────────────────────────────────────────────────────
    bot.catch((err, ctx) => {
        (0, logger_1.error)('TelegramBot', `Bot error for ${ctx.updateType}: ${err.message}`);
    });
    return bot;
}
async function launchBot() {
    const bot = createBot();
    (0, logger_1.log)('TelegramBot', 'Starting bot...');
    await bot.launch();
    (0, logger_1.log)('TelegramBot', 'Bot launched successfully');
    return bot;
}
//# sourceMappingURL=telegramBot.js.map