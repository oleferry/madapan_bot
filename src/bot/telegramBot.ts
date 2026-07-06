import { Telegraf, session } from 'telegraf';
import { CallbackQuery } from 'telegraf/types';
import { config } from '../config';
import { log, warn, error } from '../utils/logger';
import {
  BotContext,
  SessionData,
  handleStart,
  handleContact,
  handleMainMenu,
  handleViewOrder,
  handleChangeOrder,
  handleProductSelected,
  handleQuantityButton,
  handleExactQuantity,
  handleText,
  handleDaySelection,
  handleContactMadapan,
  handleShowAddProduct,
  handleAddProductSelected,
  handleAddProductQuantity,
  handleCancelLineConfirm,
  handleCancelLine,
  handleOrderHistory,
  handleAdminSelectClient,
  handleAdminByNif,
  handleAdminClientChosen,
} from './customerFlows';

function isStaff(ctx: { from?: { id: number } }): boolean {
  return config.adminTelegramIds.includes(String(ctx.from?.id ?? ''));
}

async function sendResumen(ctx: { reply: (text: string) => Promise<unknown> }): Promise<void> {
  const { toZonedTime, format } = await import('date-fns-tz');
  const { readTodayChanges, buildSummaryText } = await import('../jobs/dailySummaryJob');
  const now = toZonedTime(new Date(), config.timezone);
  const today = format(now, 'yyyy-MM-dd', { timeZone: config.timezone });
  const entries = readTodayChanges();
  await ctx.reply(buildSummaryText(entries, today));
}

async function sendProduccion(ctx: { reply: (text: string) => Promise<unknown> }): Promise<void> {
  const { getRelevantProductionDate, getDayOfWeek } = await import('../utils/dates');
  const { buildProductionSummary } = await import('../services/productionSummary');
  const dateStr = getRelevantProductionDate();
  await ctx.reply('Calculando producción...');
  const text = await buildProductionSummary(dateStr, getDayOfWeek(dateStr));
  await ctx.reply(text);
}

async function sendResumenYProduccion(ctx: { reply: (text: string) => Promise<unknown> }): Promise<void> {
  const { getRelevantProductionDate, getDayOfWeek, formatDateSpanish } = await import('../utils/dates');
  const { buildProductionSummary } = await import('../services/productionSummary');
  const { toZonedTime, format } = await import('date-fns-tz');
  const { readTodayChanges, buildSummaryText } = await import('../jobs/dailySummaryJob');

  const dateStr = getRelevantProductionDate();
  const now = toZonedTime(new Date(), config.timezone);
  const today = format(now, 'yyyy-MM-dd', { timeZone: config.timezone });

  await ctx.reply(`Calculando resumen y producción para ${formatDateSpanish(dateStr)}...`);

  const entries = readTodayChanges();
  const resumenText = buildSummaryText(entries, today);
  const produccionText = await buildProductionSummary(dateStr, getDayOfWeek(dateStr));

  await ctx.reply(`${resumenText}\n\n──────────\n\n${produccionText}`);
}

export function createBot(): Telegraf<BotContext> {
  const bot = new Telegraf<BotContext>(config.telegramBotToken);

  // Session middleware
  bot.use(
    session({
      defaultSession: (): SessionData => ({ step: 'idle' }),
    })
  );

  // ── Commands ────────────────────────────────────────────────────────────────
  bot.start(handleStart);
  bot.command('hola', handleStart);

  // Comando para obtener el chat ID (para configurar ADMIN_TELEGRAM_IDS)
  bot.command('admin', async (ctx) => {
    const chatId = ctx.chat.id;
    await ctx.reply(`Tu chat ID es: ${chatId}\n\nPara darte acceso de staff, añádelo a ADMIN_TELEGRAM_IDS en Railway.`);
  });

  // Resumen de producción bajo demanda (staff — cualquier admin)
  bot.command('produccion', async (ctx) => {
    if (!isStaff(ctx)) return;
    await sendProduccion(ctx);
  });

  // Resumen de cambios bajo demanda (staff — cualquier admin)
  bot.command('resumen', async (ctx) => {
    if (!isStaff(ctx)) return;
    await sendResumen(ctx);
  });

  // Resumen + producción combinados, en un solo comando (staff — cualquier admin)
  bot.command('resumen_produccion', async (ctx) => {
    if (!isStaff(ctx)) return;
    await sendResumenYProduccion(ctx);
  });

  // Registrar comandos en el menú "/" nativo de Telegram
  bot.telegram.setMyCommands([
    { command: 'hola', description: 'Iniciar / menú principal' },
    { command: 'resumen', description: 'Resumen de cambios de hoy (staff)' },
    { command: 'produccion', description: 'Producción del día (staff)' },
    { command: 'resumen_produccion', description: 'Resumen + producción juntos (staff)' },
    { command: 'admin', description: 'Ver mi chat ID' },
  ]).catch(err => warn('TelegramBot', `setMyCommands failed: ${(err as Error).message}`));

  // ── Contact ─────────────────────────────────────────────────────────────────
  bot.on('contact', handleContact);

  // ── Callback queries ─────────────────────────────────────────────────────────
  bot.on('callback_query', async (ctx) => {
    const cbQuery = ctx.callbackQuery as CallbackQuery.DataQuery;
    const data = cbQuery?.data ?? '';

    try {
      await ctx.answerCbQuery();

      if (data === 'main_menu') {
        await handleMainMenu(ctx);
        return;
      }

      if (data === 'view_tomorrow') {
        await handleViewOrder(ctx);
        return;
      }

      if (data === 'change_tomorrow') {
        const tomorrow = (await import('../utils/dates')).getTomorrowDate();
        await handleChangeOrder(ctx, tomorrow);
        return;
      }

      if (data === 'select_day') {
        await handleDaySelection(ctx);
        return;
      }

      if (data === 'contact_madapan') {
        await handleContactMadapan(ctx);
        return;
      }

      // day|YYYY-MM-DD
      if (data.startsWith('day|')) {
        const dateStr = data.split('|')[1]!;
        await handleChangeOrder(ctx, dateStr);
        return;
      }

      // change_order|dateStr
      if (data.startsWith('change_order|')) {
        const dateStr = data.split('|')[1]!;
        await handleChangeOrder(ctx, dateStr);
        return;
      }

      // product|lineIdx
      if (data.startsWith('product|')) {
        const lineIdx = parseInt(data.split('|')[1]!, 10);
        await handleProductSelected(ctx, lineIdx);
        return;
      }

      // d|lineIdx|delta
      if (data.startsWith('d|')) {
        const parts = data.split('|');
        const lineIdx = parseInt(parts[1]!, 10);
        const delta = parseInt(parts[2]!, 10);
        await handleQuantityButton(ctx, lineIdx, delta);
        return;
      }

      // exact|lineIdx
      if (data.startsWith('exact|')) {
        const lineIdx = parseInt(data.split('|')[1]!, 10);
        await handleExactQuantity(ctx, lineIdx);
        return;
      }

      // add_product|dateStr
      if (data.startsWith('add_product|')) {
        const dateStr = data.split('|')[1]!;
        await handleShowAddProduct(ctx, dateStr);
        return;
      }

      // ap|productCod  (add product - select)
      if (data.startsWith('ap|')) {
        const productCod = data.split('|')[1]!;
        await handleAddProductSelected(ctx, productCod);
        return;
      }

      // apq|productCod|units  (add product - quantity button)
      if (data.startsWith('apq|')) {
        const parts = data.split('|');
        const productCod = parts[1]!;
        const units = parseInt(parts[2]!, 10);
        await handleAddProductQuantity(ctx, productCod, units);
        return;
      }

      // apq_manual|productCod  (add product - manual quantity)
      if (data.startsWith('apq_manual|')) {
        const productCod = data.split('|')[1]!;
        await handleAddProductSelected(ctx, productCod);
        return;
      }

      // cancel_line|lineIdx — pedir confirmación
      if (data.startsWith('cancel_line|') && !data.startsWith('cancel_line_ok|')) {
        const lineIdx = parseInt(data.split('|')[1]!, 10);
        await handleCancelLineConfirm(ctx, lineIdx);
        return;
      }

      // cancel_line_ok|lineIdx — confirmar y ejecutar
      if (data.startsWith('cancel_line_ok|')) {
        const lineIdx = parseInt(data.split('|')[1]!, 10);
        await handleCancelLine(ctx, lineIdx);
        return;
      }

      // view_order|dateStr
      if (data.startsWith('view_order|')) {
        const dateStr = data.split('|')[1]!;
        await handleViewOrder(ctx, dateStr);
        return;
      }

      // order_history
      if (data === 'order_history') {
        await handleOrderHistory(ctx);
        return;
      }

      // admin_select_client
      if (data === 'admin_select_client') {
        await handleAdminSelectClient(ctx);
        return;
      }

      // admin_by_nif — buscar cliente escribiendo NIF
      if (data === 'admin_by_nif') {
        await handleAdminByNif(ctx);
        return;
      }

      // acli|NIF — cliente elegido del desplegable
      if (data.startsWith('acli|')) {
        const nif = data.split('|')[1]!;
        await handleAdminClientChosen(ctx, nif);
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

      warn('TelegramBot', `Unhandled callback: ${data}`);
    } catch (err) {
      error('TelegramBot', `Callback error for "${data}": ${(err as Error).message}`);
      try {
        await ctx.reply('Ha ocurrido un error. Por favor inténtalo de nuevo.');
      } catch {
        // ignore
      }
    }
  });

  // ── Text messages ───────────────────────────────────────────────────────────
  bot.on('text', handleText);

  // ── Error handler ───────────────────────────────────────────────────────────
  bot.catch((err, ctx) => {
    error('TelegramBot', `Bot error for ${ctx.updateType}: ${(err as Error).message}`);
  });

  return bot;
}

export async function launchBot(): Promise<Telegraf<BotContext>> {
  const bot = createBot();
  log('TelegramBot', 'Starting bot...');
  await bot.launch();
  log('TelegramBot', 'Bot launched successfully');
  return bot;
}
