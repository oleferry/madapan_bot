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
  handleAdminPizzaStockPrompt,
  handleAdminPizzaPedidos,
  handleIdentifyClient,
} from './customerFlows';
import {
  handlePizzaStart,
  handlePizzaTipoElegido,
  handlePizzaElegida,
  handlePizzaPostreElegido,
  handlePizzaCantidadElegida,
  handlePizzaDiaElegido,
  handlePizzaCalendarNav,
  handlePizzaHoraElegida,
  handlePizzaText,
  handlePizzaMarketing,
  handlePizzaMas,
  handlePizzaSeguir,
  handlePizzaCancelMine,
  handleAdminCancelPizza,
  handlePizzaCancelPrompt,
  handlePizzaCancelConfirm,
} from './pizzaFlow';
import * as pizzaService from '../services/pizzaService';
import { sendDailyWaybills } from '../jobs/dailyWaybillsJob';

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
  bot.start(async (ctx) => {
    // Deep link t.me/<bot>?start=pizza → entra directo al flujo de reserva de pizza
    const payload = (ctx as unknown as { startPayload?: string }).startPayload;
    if (payload === 'pizza') {
      await handlePizzaStart(ctx);
      return;
    }
    await handleStart(ctx);
  });
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

  // Albaranes del día en PDF, bajo demanda (staff). Admite fecha opcional
  // YYYY-MM-DD para reimprimir/generar la de otro día; por defecto hoy.
  // ⚠️ Convierte pedidos en albaranes reales en Holded (documentos permanentes).
  bot.command('albaranes', async (ctx) => {
    if (!isStaff(ctx)) return;
    const arg = ctx.message.text.split(' ')[1];
    const { toZonedTime, format } = await import('date-fns-tz');
    const dateStr = arg && /^\d{4}-\d{2}-\d{2}$/.test(arg)
      ? arg
      : format(toZonedTime(new Date(), config.timezone), 'yyyy-MM-dd', { timeZone: config.timezone });
    await ctx.reply(`Generando albaranes de ${dateStr}...`);
    try {
      await sendDailyWaybills(ctx.telegram, dateStr);
    } catch (err) {
      error('TelegramBot', `/albaranes failed: ${(err as Error).message}`);
      await ctx.reply('Error generando los albaranes. Revisa los logs.');
    }
  });

  // Pizzas — reserva pública, abierta a cualquier usuario
  bot.command('pizza', handlePizzaStart);

  // Cancelar mi reserva de pizza — pública (cada uno solo ve las suyas)
  bot.command('cancelar_pizza', handlePizzaCancelMine);

  // Admin: fija el stock de pizzas para un finde concreto (por defecto, el próximo)
  bot.command('pizzas_stock', async (ctx) => {
    if (!isStaff(ctx)) return;
    const parts = ctx.message.text.trim().split(/\s+/);
    const n = parseInt(parts[1] ?? '', 10);
    if (isNaN(n) || n < 0) {
      await ctx.reply(
        'Uso: /pizzas_stock <número de unidades> [fecha YYYY-MM-DD]\n' +
        'Ejemplo: /pizzas_stock 40\n' +
        'Con fecha (cualquier finde futuro): /pizzas_stock 40 2026-08-01'
      );
      return;
    }
    let weekOf: string | undefined;
    if (parts[2]) {
      try {
        weekOf = pizzaService.weekendKeyForPickedDate(parts[2]);
      } catch (err) {
        await ctx.reply(`Fecha inválida: ${(err as Error).message}`);
        return;
      }
    }
    const finalWeekOf = pizzaService.setWeekendStock(n, weekOf);
    await ctx.reply(`✅ Stock de pizzas fijado a ${n} unidades para el finde del ${pizzaService.formatPizzaDate(finalWeekOf)}.`);
  });

  // Admin: resumen de reservas de pizza del finde en curso
  bot.command('pedidos_pizzas', async (ctx) => {
    if (!isStaff(ctx)) return;
    await ctx.reply(pizzaService.buildPizzaOrdersSummary());
  });

  // Admin: abrir un día puntual para reserva pública de pizza (p.ej. un martes especial)
  bot.command('pizzas_dia_extra', async (ctx) => {
    if (!isStaff(ctx)) return;
    const fecha = ctx.message.text.trim().split(/\s+/)[1];
    if (!fecha) {
      await ctx.reply('Uso: /pizzas_dia_extra <fecha YYYY-MM-DD>\nEjemplo: /pizzas_dia_extra 2026-07-14');
      return;
    }
    try {
      pizzaService.addExtraPizzaDate(fecha);
      await ctx.reply(`✅ ${pizzaService.formatPizzaDate(fecha)} añadido como día puntual reservable.`);
    } catch (err) {
      await ctx.reply(`Fecha inválida: ${(err as Error).message}`);
    }
  });

  // Admin: quitar un día puntual
  bot.command('pizzas_dia_extra_quitar', async (ctx) => {
    if (!isStaff(ctx)) return;
    const fecha = ctx.message.text.trim().split(/\s+/)[1];
    if (!fecha) {
      await ctx.reply('Uso: /pizzas_dia_extra_quitar <fecha YYYY-MM-DD>');
      return;
    }
    const quitado = pizzaService.removeExtraPizzaDate(fecha);
    await ctx.reply(quitado ? `✅ ${pizzaService.formatPizzaDate(fecha)} eliminado de los días puntuales.` : 'Esa fecha no estaba en la lista de días puntuales.');
  });

  // Registrar comandos en el menú "/" nativo de Telegram.
  // Los comandos de staff se registran SOLO en el chat de cada admin, usando el
  // scope de Telegram, para que los clientes no los vean en su menú.
  const publicCommands = [
    { command: 'hola', description: 'Iniciar / menú principal' },
    { command: 'pizza', description: 'Reservar pizza de fin de semana' },
    { command: 'cancelar_pizza', description: 'Cancelar mi reserva de pizza' },
    { command: 'admin', description: 'Ver mi chat ID' },
  ];
  const staffCommands = [
    ...publicCommands,
    { command: 'resumen', description: 'Resumen de cambios de hoy (staff)' },
    { command: 'produccion', description: 'Producción del día (staff)' },
    { command: 'resumen_produccion', description: 'Resumen + producción juntos (staff)' },
    { command: 'pizzas_stock', description: 'Fijar stock de pizzas del finde (staff)' },
    { command: 'pizzas_dia_extra', description: 'Abrir un día puntual de pizza (staff)' },
    { command: 'pizzas_dia_extra_quitar', description: 'Quitar un día puntual de pizza (staff)' },
    { command: 'pedidos_pizzas', description: 'Ver reservas de pizza del finde (staff)' },
    { command: 'albaranes', description: 'PDF de albaranes del día (staff)' },
  ];

  // Comandos públicos → visibles para todos los usuarios (scope por defecto)
  bot.telegram.setMyCommands(publicCommands)
    .catch(err => warn('TelegramBot', `setMyCommands (public) failed: ${(err as Error).message}`));

  // Comandos de staff → visibles solo en el chat de cada admin
  for (const adminId of config.adminTelegramIds) {
    const chatId = Number(adminId);
    if (Number.isNaN(chatId)) {
      warn('TelegramBot', `ADMIN_TELEGRAM_IDS contiene un id no numérico: "${adminId}"`);
      continue;
    }
    bot.telegram.setMyCommands(staffCommands, { scope: { type: 'chat', chat_id: chatId } })
      .catch(err => warn('TelegramBot', `setMyCommands (staff ${adminId}) failed: ${(err as Error).message}`));
  }

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

      // start_pizza — botón "Reservar pizza" del menú de bienvenida (público)
      if (data === 'start_pizza') {
        await handlePizzaStart(ctx);
        return;
      }

      // identify_client — botón "Ya soy cliente de Madapan" (identificación por DNI)
      if (data === 'identify_client') {
        await handleIdentifyClient(ctx);
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

      // Acciones de administrador — verificación de permisos (defensa en profundidad).
      // Estos botones solo se envían a admins, pero bloqueamos también el callback
      // por si alguien intentara dispararlo de forma fabricada.
      const adminCallbacks = [
        'admin_select_client', 'admin_by_nif',
        'admin_resumen_produccion', 'admin_resumen', 'admin_produccion',
        'admin_pizzas_stock', 'admin_pizzas_pedidos', 'admin_cancel_pizza',
      ];
      if ((adminCallbacks.includes(data) || data.startsWith('acli|')) && !isStaff(ctx)) {
        warn('TelegramBot', `Non-staff callback bloqueado: "${data}" from ${ctx.from?.id}`);
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

      // pz_tipo|individual|menu
      if (data.startsWith('pz_tipo|')) {
        const tipo = data.split('|')[1] as 'individual' | 'menu';
        await handlePizzaTipoElegido(ctx, tipo);
        return;
      }

      // pz_pizza|id
      if (data.startsWith('pz_pizza|')) {
        const pizzaId = data.split('|')[1]!;
        await handlePizzaElegida(ctx, pizzaId);
        return;
      }

      // pz_postre|numero|id
      if (data.startsWith('pz_postre|')) {
        const parts = data.split('|');
        await handlePizzaPostreElegido(ctx, parseInt(parts[1]!, 10), parts[2]!);
        return;
      }

      // pz_cant|n
      if (data.startsWith('pz_cant|')) {
        await handlePizzaCantidadElegida(ctx, parseInt(data.split('|')[1]!, 10));
        return;
      }

      // pz_cancel_mine — cliente: cancelar mi reserva
      if (data === 'pz_cancel_mine') {
        await handlePizzaCancelMine(ctx);
        return;
      }

      // admin_cancel_pizza — admin: cancelar cualquier reserva (guard isStaff arriba)
      if (data === 'admin_cancel_pizza') {
        await handleAdminCancelPizza(ctx);
        return;
      }

      // pz_cancel_ok|PZ-XXXX — confirmar cancelación (antes que pz_cancel|)
      if (data.startsWith('pz_cancel_ok|')) {
        await handlePizzaCancelConfirm(ctx, data.split('|')[1]!);
        return;
      }

      // pz_cancel|PZ-XXXX — pedir confirmación de cancelación
      if (data.startsWith('pz_cancel|')) {
        await handlePizzaCancelPrompt(ctx, data.split('|')[1]!);
        return;
      }

      // pz_mas — añadir otra pizza al carrito
      if (data === 'pz_mas') {
        await handlePizzaMas(ctx);
        return;
      }

      // pz_seguir — continuar con la recogida
      if (data === 'pz_seguir') {
        await handlePizzaSeguir(ctx);
        return;
      }

      // pz_noop — celda no interactiva del calendario (relleno/cabecera)
      if (data === 'pz_noop') {
        return;
      }

      // pz_cal|YYYY-MM — navegar de mes en el calendario
      if (data.startsWith('pz_cal|')) {
        await handlePizzaCalendarNav(ctx, data.split('|')[1]!);
        return;
      }

      // pz_calday|YYYY-MM-DD — fecha exacta elegida en el calendario
      if (data.startsWith('pz_calday|')) {
        await handlePizzaDiaElegido(ctx, data.split('|')[1]!);
        return;
      }

      // pz_hora|HH:mm
      if (data.startsWith('pz_hora|')) {
        await handlePizzaHoraElegida(ctx, data.split('|')[1]!);
        return;
      }

      // pz_promo|si|no — consentimiento de marketing (protección de datos)
      if (data.startsWith('pz_promo|')) {
        await handlePizzaMarketing(ctx, data.split('|')[1] === 'si');
        return;
      }

      // admin_pizzas_stock — botón del menú admin
      if (data === 'admin_pizzas_stock') {
        await handleAdminPizzaStockPrompt(ctx);
        return;
      }

      // admin_pizzas_pedidos — botón del menú admin
      if (data === 'admin_pizzas_pedidos') {
        await handleAdminPizzaPedidos(ctx);
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
  bot.on('text', async (ctx) => {
    const handledByPizza = await handlePizzaText(ctx);
    if (handledByPizza) return;
    await handleText(ctx);
  });

  // ── Error handler ───────────────────────────────────────────────────────────
  bot.catch((err, ctx) => {
    error('TelegramBot', `Bot error for ${ctx.updateType}: ${(err as Error).message}`);
  });

  return bot;
}

export async function launchBot(): Promise<Telegraf<BotContext>> {
  const bot = createBot();
  log('TelegramBot', 'Starting bot...');
  // bot.launch() no se resuelve mientras el bot esté vivo (el polling es un
  // bucle infinito) — no se espera, para no bloquear el resto del arranque
  // (scheduleDailySummary/scheduleProductionSummary, que inicializan el
  // notificador de admin).
  bot.launch()
    .then(() => log('TelegramBot', 'Bot launched successfully'))
    .catch(err => error('TelegramBot', `Bot launch failed: ${(err as Error).message}`));
  return bot;
}
