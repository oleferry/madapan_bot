import { Context, Markup } from 'telegraf';
import { Message } from 'telegraf/types';
import { Customer } from '../types';
import * as orderService from '../services/orderService';
import * as clientCache from '../services/clientCache';
import * as catalogService from '../services/catalogService';
import { parseCustomerMessage } from '../services/messageParser';
import { getTomorrowDate, formatDateSpanish, getCurrentWeekDates } from '../utils/dates';
import { log, warn } from '../utils/logger';
import { config } from '../config';

// ── Session ───────────────────────────────────────────────────────────────────

export interface SessionData {
  step:
    | 'idle'
    | 'awaiting_phone'
    | 'selecting_product'
    | 'selecting_day'
    | 'entering_exact'
    | 'admin_awaiting_nif'
    | 'pizza_awaiting_name'
    | 'pizza_awaiting_phone'
    | 'pizza_awaiting_email'
    | 'pizza_awaiting_marketing'
    | 'admin_awaiting_pizza_stock';
  isAdmin?: boolean;
  pizzaOrder?: import('./pizzaFlow').PizzaSessionData;
  selectedDate?: string;
  selectedOrderId?: string;
  selectedLineId?: string;
  selectedLineName?: string;
  selectedLineCurrentUnits?: number;
  customer?: Customer;
  // líneas del pedido actual guardadas en sesión para evitar IDs largos en botones
  orderLines?: Array<{ id: string; name: string; units: number }>;
  addingProduct?: boolean;
  pendingCancelLineIdx?: number; // índice de línea pendiente de confirmar cancelación
}

export type BotContext = Context & { session: SessionData };

// ── /start ────────────────────────────────────────────────────────────────────

function isAdmin(ctx: BotContext): boolean {
  const telegramId = String(ctx.from?.id ?? '');
  return config.adminTelegramIds.includes(telegramId);
}

export async function handleStart(ctx: BotContext): Promise<void> {
  const telegramId = String(ctx.from?.id ?? '');

  try {
    // Los administradores ven el menú de admin
    if (isAdmin(ctx)) {
      ctx.session.isAdmin = true;
      await sendAdminMenu(ctx);
      return;
    }

    const cached = clientCache.getClient(telegramId);
    if (cached) {
      ctx.session.customer = cached;
      ctx.session.step = 'idle';
      await sendMainMenu(ctx, cached.name);
      return;
    }

    // Usuario sin identificar → menú de bienvenida (pizza / identificarse)
    await sendWelcomeMenu(ctx);
  } catch (err) {
    warn('CustomerFlows', `handleStart error: ${(err as Error).message}`);
    await ctx.reply('Ha ocurrido un error. Por favor inténtalo de nuevo más tarde.');
  }
}

// ── Contact received ──────────────────────────────────────────────────────────

export async function handleContact(ctx: BotContext): Promise<void> {
  const telegramId = String(ctx.from?.id ?? '');
  const contact = (ctx.message as Message.ContactMessage | undefined)?.contact;

  if (!contact?.phone_number) {
    await ctx.reply('No he podido leer tu número. Por favor intenta de nuevo con /start.');
    return;
  }

  try {
    const customer = await orderService.getOrRegisterCustomer(telegramId, contact.phone_number);

    if (!customer) {
      await ctx.reply(
        'No estás registrado en Madapan. Contacta con nosotros.',
        Markup.removeKeyboard()
      );
      return;
    }

    ctx.session.customer = customer;
    ctx.session.step = 'idle';
    log('CustomerFlows', `Registered customer ${customer.name} (${telegramId})`);

    await ctx.reply(
      `Bienvenido, ${customer.name}!`,
      Markup.removeKeyboard()
    );
    await sendMainMenu(ctx, customer.name);
  } catch (err) {
    warn('CustomerFlows', `handleContact error: ${(err as Error).message}`);
    await ctx.reply('Error al verificar tu teléfono. Inténtalo de nuevo.');
  }
}

// ── Main menu ─────────────────────────────────────────────────────────────────

async function sendMainMenu(ctx: BotContext, name: string): Promise<void> {
  const { isAfterCutoff } = await import('../utils/dates');
  const afterCutoff = isAfterCutoff();
  const aviso = afterCutoff
    ? '\n⚠️ Son más de las 20:00 — los cambios grandes pueden requerir confirmación de Madapan.'
    : '';
  await ctx.reply(
    `Hola, ${name}!${aviso}\n\n¿Qué deseas hacer?`,
    Markup.inlineKeyboard([
      [Markup.button.callback('Ver pedido de mañana', 'view_tomorrow')],
      [Markup.button.callback('Modificar pedido de mañana', 'change_tomorrow')],
      [Markup.button.callback('Modificar otro día', 'select_day')],
      [Markup.button.callback('Historial de pedidos', 'order_history')],
      [Markup.button.callback('Contactar con Madapan', 'contact_madapan')],
    ])
  );
}

// Menú de bienvenida para usuarios SIN identificar: solo reserva de pizzas
// (pública) y la opción de identificarse como cliente de Madapan con su DNI.
async function sendWelcomeMenu(ctx: BotContext): Promise<void> {
  ctx.session.step = 'idle';
  await ctx.reply(
    'Hola! Soy el bot de Madapan 🥖\n\n¿Qué deseas hacer?',
    Markup.inlineKeyboard([
      [Markup.button.callback('🍕 Reservar pizza de fin de semana', 'start_pizza')],
      [Markup.button.callback('🥖 Ya soy cliente de Madapan', 'identify_client')],
    ])
  );
}

// Inicia la identificación por DNI/CIF de un cliente de Madapan.
export async function handleIdentifyClient(ctx: BotContext): Promise<void> {
  ctx.session.step = 'awaiting_phone';
  await ctx.reply(
    'Para acceder a tus pedidos, escribe tu NIF o CIF (por ejemplo: 12345678A o B12345678):',
    Markup.removeKeyboard()
  );
}

export async function handleMainMenu(ctx: BotContext): Promise<void> {
  const telegramId = String(ctx.from?.id ?? '');

  // Admin sin cliente cargado → menú de administrador
  if ((ctx.session.isAdmin || config.adminTelegramIds.includes(telegramId)) && !ctx.session.customer) {
    ctx.session.isAdmin = true;
    await sendAdminMenu(ctx);
    return;
  }

  // Cliente identificado → su menú de pedidos
  const customer = ctx.session.customer ?? clientCache.getClient(telegramId);
  if (customer) {
    ctx.session.customer = customer;
    await sendMainMenu(ctx, customer.name);
    return;
  }

  // Usuario sin identificar → menú de bienvenida (pizza / identificarse)
  await sendWelcomeMenu(ctx);
}

// ── Admin menu ──────────────────────────────────────────────────────────────────

async function sendAdminMenu(ctx: BotContext): Promise<void> {
  const clienteActual = ctx.session.customer
    ? `\n\nCliente actual: ${ctx.session.customer.name}`
    : '';
  await ctx.reply(
    `Modo administrador 🔧${clienteActual}\n\n¿Qué deseas hacer?`,
    Markup.inlineKeyboard([
      [Markup.button.callback('Resumen de cambios', 'admin_resumen')],
      [Markup.button.callback('Producción', 'admin_produccion')],
      [Markup.button.callback('Editar pedido de un cliente', 'admin_select_client')],
      [Markup.button.callback('Stock de pizzas', 'admin_pizzas_stock')],
      [Markup.button.callback('Pedidos de pizzas', 'admin_pizzas_pedidos')],
      ...(ctx.session.customer
        ? [[Markup.button.callback(`Seguir con ${ctx.session.customer.name}`, 'view_tomorrow')]]
        : []),
    ])
  );
}

export async function handleAdminSelectClient(ctx: BotContext): Promise<void> {
  ctx.session.customer = undefined;
  ctx.session.step = 'idle';

  const clientes = catalogService.getAllClients();
  if (clientes.length === 0) {
    // Fallback: pedir NIF por texto si no hay clientes en el catálogo
    ctx.session.step = 'admin_awaiting_nif';
    await ctx.reply('Escribe el NIF/CIF del cliente cuyo pedido quieres editar:');
    return;
  }

  // Un botón por cliente; callback "acli|NIF"
  const buttons = clientes.map(c => [Markup.button.callback(c.name, `acli|${c.nif}`)]);
  buttons.push([Markup.button.callback('Buscar por NIF', 'admin_by_nif')]);

  await ctx.reply('Selecciona el cliente cuyo pedido quieres editar:', Markup.inlineKeyboard(buttons));
}

export async function handleAdminByNif(ctx: BotContext): Promise<void> {
  ctx.session.step = 'admin_awaiting_nif';
  ctx.session.customer = undefined;
  await ctx.reply('Escribe el NIF/CIF del cliente:');
}

export async function handleAdminClientChosen(ctx: BotContext, nif: string): Promise<void> {
  await adminLoadClient(ctx, nif);
}

export async function handleAdminPizzaStockPrompt(ctx: BotContext): Promise<void> {
  ctx.session.step = 'admin_awaiting_pizza_stock';
  await ctx.reply('¿Cuántas unidades de pizza hay disponibles este fin de semana? Escribe el número:');
}

export async function handleAdminPizzaPedidos(ctx: BotContext): Promise<void> {
  const { buildPizzaOrdersSummary } = await import('../services/pizzaService');
  await ctx.reply(buildPizzaOrdersSummary());
}

// Carga un cliente por NIF para que el admin opere sobre su pedido
async function adminLoadClient(ctx: BotContext, nif: string): Promise<void> {
  const contact = await (await import('../services/holdedClient')).findContactByNif(nif);
  if (!contact) {
    await ctx.reply('No he encontrado ese NIF en Holded. Comprueba que es correcto e inténtalo de nuevo.');
    return;
  }

  const catalogClient = contact.code ? catalogService.getClientByNif(contact.code) : null;
  const customer: Customer = {
    telegramId: String(ctx.from?.id ?? ''),
    holdedContactId: contact.id,
    name: contact.name,
    phone: contact.phone ?? '',
    tarifa: catalogClient?.tarifa ?? 'Tarifa 2025',
    discount: catalogClient?.discount ?? 20,
  };

  ctx.session.customer = customer;
  ctx.session.step = 'idle';
  log('CustomerFlows', `Admin ${ctx.from?.id} editando cliente ${customer.name}`);

  await ctx.reply(`✅ Cliente cargado: ${customer.name}`);
  await sendMainMenu(ctx, customer.name);
}

// ── View order ────────────────────────────────────────────────────────────────

export async function handleViewOrder(ctx: BotContext, dateStr?: string): Promise<void> {
  const customer = await resolveCustomer(ctx);
  if (!customer) return;

  const date = dateStr ?? getTomorrowDate();

  try {
    const order = await orderService.getOrderForDate(customer, date);

    if (!order) {
      await ctx.reply(`No hay pedido para ${formatDateSpanish(date)}.`);
      return;
    }

    // Guardar líneas en sesión para acceso por índice
    ctx.session.orderLines = order.lines.map(l => ({ id: l.id, name: l.name, units: l.units }));
    ctx.session.selectedOrderId = order.id;
    ctx.session.selectedDate = date;

    let text = `Pedido para ${formatDateSpanish(date)}:\n\n`;
    for (const line of order.lines) {
      text += `• ${line.name}: ${line.units} uds\n`;
    }

    await ctx.reply(text,
      Markup.inlineKeyboard([
        [Markup.button.callback('Modificar cantidades', `change_order|${date}`)],
        [Markup.button.callback('Añadir producto', `add_product|${date}`)],
        [Markup.button.callback('Menú principal', 'main_menu')],
      ])
    );
  } catch (err) {
    warn('CustomerFlows', `handleViewOrder error: ${(err as Error).message}`);
    await ctx.reply('Error al obtener el pedido. Inténtalo de nuevo.');
  }
}

// ── Change order ──────────────────────────────────────────────────────────────

export async function handleChangeOrder(
  ctx: BotContext,
  dateStr: string
): Promise<void> {
  const customer = await resolveCustomer(ctx);
  if (!customer) return;

  try {
    const order = await orderService.getOrderForDate(customer, dateStr);

    if (!order || order.lines.length === 0) {
      await ctx.reply(`No hay pedido para ${formatDateSpanish(dateStr)}.`);
      return;
    }

    ctx.session.selectedOrderId = order.id;
    ctx.session.selectedDate = dateStr;
    ctx.session.orderLines = order.lines.map(l => ({ id: l.id, name: l.name, units: l.units }));

    // Usar índice en callback para mantener < 64 chars: "product|0", "product|1"...
    const buttons = order.lines.map((line, idx) => [
      Markup.button.callback(
        `${line.name} (${line.units} uds)`,
        `product|${idx}`
      ),
    ]);
    buttons.push([Markup.button.callback('Cancelar', 'main_menu')]);

    await ctx.reply(
      `Pedido para ${formatDateSpanish(dateStr)} - ¿Qué producto modificas?`,
      Markup.inlineKeyboard(buttons)
    );
  } catch (err) {
    warn('CustomerFlows', `handleChangeOrder error: ${(err as Error).message}`);
    await ctx.reply('Error al cargar el pedido. Inténtalo de nuevo.');
  }
}

// ── Product selected ──────────────────────────────────────────────────────────

// lineIdx es el índice en ctx.session.orderLines
export async function handleProductSelected(
  ctx: BotContext,
  lineIdx: number
): Promise<void> {
  const sessionLine = ctx.session.orderLines?.[lineIdx];
  if (!sessionLine || !ctx.session.selectedOrderId || !ctx.session.selectedDate) {
    await ctx.reply('Sesión expirada. Usa /hola para empezar de nuevo.');
    return;
  }

  ctx.session.selectedLineId = sessionLine.id;
  ctx.session.selectedLineName = sessionLine.name;
  ctx.session.selectedLineCurrentUnits = sessionLine.units;

  // Callbacks cortos: "d|índice|delta" (delta: -5/-2/-1/+1/+2/+5)
  const i = lineIdx;
  await ctx.reply(
    `${sessionLine.name} — cantidad actual: ${sessionLine.units} uds\n\n¿Cuánto quieres cambiar?`,
    Markup.inlineKeyboard([
      [
        Markup.button.callback('-5', `d|${i}|-5`),
        Markup.button.callback('-2', `d|${i}|-2`),
        Markup.button.callback('-1', `d|${i}|-1`),
        Markup.button.callback('+1', `d|${i}|1`),
        Markup.button.callback('+2', `d|${i}|2`),
        Markup.button.callback('+5', `d|${i}|5`),
      ],
      [Markup.button.callback('Cantidad exacta', `exact|${i}`)],
      [Markup.button.callback('Eliminar del pedido', `cancel_line|${i}`)],
      [Markup.button.callback('Volver', 'main_menu')],
    ])
  );
}

// ── Quantity button ───────────────────────────────────────────────────────────

export async function handleQuantityButton(
  ctx: BotContext,
  lineIdx: number,
  delta: number
): Promise<void> {
  const customer = await resolveCustomer(ctx);
  if (!customer) return;

  const sessionLine = ctx.session.orderLines?.[lineIdx];
  const dateStr = ctx.session.selectedDate;
  const orderId = ctx.session.selectedOrderId;

  if (!sessionLine || !dateStr || !orderId) {
    await ctx.reply('Sesión expirada. Usa /hola para empezar de nuevo.');
    return;
  }

  try {
    const order = await orderService.getOrderForDate(customer, dateStr);
    if (!order) {
      await ctx.reply('No se pudo cargar el pedido.');
      return;
    }

    const line = order.lines.find((l) => l.id === sessionLine.id);
    if (!line) {
      await ctx.reply('Producto no encontrado.');
      return;
    }

    const newUnits = Math.max(0, line.units + delta);
    const result = await orderService.changeLineUnits({
      customer,
      order,
      lineId: line.id,
      newUnits,
      source: 'button',
    });

    // Actualizar unidades en sesión
    if (ctx.session.orderLines) ctx.session.orderLines[lineIdx].units = newUnits;

    await ctx.reply(result.message, Markup.inlineKeyboard([
      [Markup.button.callback('Seguir modificando', `change_order|${ctx.session.selectedDate}`)],
      [Markup.button.callback('Ver pedido actualizado', 'view_tomorrow')],
      [Markup.button.callback('Menú principal', 'main_menu')],
    ]));
  } catch (err) {
    warn('CustomerFlows', `handleQuantityButton error: ${(err as Error).message}`);
    await ctx.reply('Error al aplicar el cambio. Inténtalo de nuevo.');
  }
}

// ── Exact quantity ────────────────────────────────────────────────────────────

export async function handleExactQuantity(
  ctx: BotContext,
  lineIdx: number
): Promise<void> {
  ctx.session.step = 'entering_exact';
  ctx.session.selectedLineId = ctx.session.orderLines?.[lineIdx]?.id;
  await ctx.reply('Escribe la cantidad exacta (número entero):');
}

// ── Text handler ──────────────────────────────────────────────────────────────

export async function handleText(ctx: BotContext): Promise<void> {
  if (!ctx.message || !('text' in ctx.message)) return;
  const text = (ctx.message as Message.TextMessage).text;
  try {
    // Admin: fijar stock de pizzas
    if (ctx.session.step === 'admin_awaiting_pizza_stock') {
      const n = parseInt(text.trim(), 10);
      if (isNaN(n) || n < 0) {
        await ctx.reply('Por favor escribe un número válido (0 o más):');
        return;
      }
      ctx.session.step = 'idle';
      const { setWeekendStock } = await import('../services/pizzaService');
      setWeekendStock(n);
      await ctx.reply(`✅ Stock de pizzas fijado a ${n} unidades para este fin de semana.`);
      return;
    }

    // Admin: cargar cliente por NIF
    if (ctx.session.step === 'admin_awaiting_nif') {
      const nif = text.trim();
      const nifLike = /^[A-Z0-9]{7,12}$/i.test(nif.replace(/[\s\-]/g, ''));
      if (!nifLike) {
        await ctx.reply('Por favor escribe un NIF/CIF válido (por ejemplo: 12345678A o B12345678):');
        return;
      }
      await adminLoadClient(ctx, nif);
      return;
    }

    // Registro por NIF
    if (ctx.session.step === 'awaiting_phone') {
      const telegramId = String(ctx.from?.id ?? '');

      // Ignorar saludos y texto que claramente no es un NIF
      const nifLike = /^[A-Z0-9]{7,12}$/i.test(text.trim().replace(/[\s\-]/g, ''));
      if (!nifLike) {
        await ctx.reply('Por favor escribe tu NIF o CIF (por ejemplo: 12345678A o B12345678):');
        return;
      }

      const customer = await orderService.getOrRegisterCustomer(telegramId, text.trim());
      if (!customer) {
        await ctx.reply(
          'No he encontrado ese NIF en Madapan. Comprueba que es correcto o contacta con nosotros.'
        );
        return;
      }
      ctx.session.customer = customer;
      ctx.session.step = 'idle';
      await ctx.reply(
        `Bienvenido, ${customer.name}! 👋\n\n` +
        `Desde aquí puedes:\n` +
        `• Ver tu pedido del día siguiente\n` +
        `• Cambiar cantidades de cualquier producto\n` +
        `• Añadir productos que no estén en el pedido\n\n` +
        `⚠️ Los cambios se admiten hasta las 20:00 del día anterior a la entrega.\n` +
        `Los panes especiales (centeno, semillas, integral, pasas y nueces) necesitan al menos 24h de antelación.\n\n` +
        `Para cualquier duda: 722 833 052 · hola@madapan.es (9:00–14:00)`
      );
      await sendMainMenu(ctx, customer.name);
      return;
    }

    // Usuario sin identificar (y fuera del flujo de pizza) → menú de bienvenida
    const telegramId = String(ctx.from?.id ?? '');
    const isAdminUser = ctx.session.isAdmin || config.adminTelegramIds.includes(telegramId);
    if (!ctx.session.customer && !clientCache.getClient(telegramId) && !isAdminUser) {
      await sendWelcomeMenu(ctx);
      return;
    }

    const customer = await resolveCustomer(ctx);
    if (!customer) return;

    // Handle quantity for adding a new product
    if (ctx.session.step === 'entering_exact' && ctx.session.addingProduct && ctx.session.selectedLineId) {
      const qty = parseInt(text.trim(), 10);
      if (isNaN(qty) || qty <= 0) {
        await ctx.reply('Por favor escribe un número válido (mayor que 0).');
        return;
      }
      const productCod = ctx.session.selectedLineId;
      ctx.session.step = 'idle';
      ctx.session.addingProduct = false;
      ctx.session.selectedLineId = undefined;
      await handleAddProductQuantity(ctx, productCod, qty);
      return;
    }

    // Handle exact quantity input
    if (
      ctx.session.step === 'entering_exact' &&
      ctx.session.selectedLineId &&
      ctx.session.selectedOrderId &&
      ctx.session.selectedDate
    ) {
      const qty = parseInt(text.trim(), 10);
      if (isNaN(qty) || qty < 0) {
        await ctx.reply('Por favor escribe un número válido (0 o más).');
        return;
      }

      const lineId = ctx.session.selectedLineId;
      const dateStr = ctx.session.selectedDate;
      ctx.session.step = 'idle';
      ctx.session.selectedLineId = undefined;
      ctx.session.selectedOrderId = undefined;
      ctx.session.selectedDate = undefined;

      const order = await orderService.getOrderForDate(customer, dateStr);
      if (!order) {
        await ctx.reply('No se pudo cargar el pedido.');
        return;
      }

      const result = await orderService.changeLineUnits({
        customer,
        order,
        lineId,
        newUnits: qty,
        source: 'text',
      });

      await ctx.reply(result.message);
      return;
    }

    // Try to parse as natural language change request
    const parsed = parseCustomerMessage(text, new Date());

    if (parsed.status === 'unsupported') {
      await ctx.reply(
        `No puedo procesar ese tipo de solicitud. ${parsed.reason ?? ''}\n\nIndica el producto y la cantidad exacta.`
      );
      return;
    }

    if (parsed.status === 'ambiguous') {
      await ctx.reply(
        `No he podido entender tu solicitud.\n\n${parsed.reason ?? 'Por favor sé más específico con el producto, la cantidad y el día.'}`
      );
      return;
    }

    const dateStr = parsed.deliveryDate!;
    const order = await orderService.getOrderForDate(customer, dateStr);

    if (!order) {
      await ctx.reply(`No hay pedido para ${formatDateSpanish(dateStr)}.`);
      return;
    }

    const messages: string[] = [];

    for (const action of parsed.actions) {
      // Match by name alias
      const line = order.lines.find((l) =>
        l.name.toLowerCase().includes(action.productAlias) ||
        action.productAlias.split(' ').some((word) => l.name.toLowerCase().includes(word))
      );

      if (!line) {
        messages.push(`Producto "${action.productAlias}" no encontrado en tu pedido.`);
        continue;
      }

      let newUnits: number;
      if (action.type === 'increment') {
        newUnits = line.units + action.quantity;
      } else if (action.type === 'decrement') {
        newUnits = Math.max(0, line.units - action.quantity);
      } else {
        newUnits = action.quantity;
      }

      const result = await orderService.changeLineUnits({
        customer,
        order,
        lineId: line.id,
        newUnits,
        source: 'text',
      });

      messages.push(result.message);
    }

    await ctx.reply(messages.join('\n'));
  } catch (err) {
    warn('CustomerFlows', `handleText error: ${(err as Error).message}`);
    await ctx.reply('Ha ocurrido un error procesando tu mensaje. Inténtalo de nuevo.');
  }
}

// ── Day selection ─────────────────────────────────────────────────────────────

export async function handleDaySelection(ctx: BotContext): Promise<void> {
  const weekDates = getCurrentWeekDates();
  const buttons = Object.entries(weekDates).map(([day, date]) => [
    Markup.button.callback(
      `${day.charAt(0).toUpperCase() + day.slice(1)} (${date.slice(5).replace('-', '/')})`,
      `day|${date}`
    ),
  ]);
  buttons.push([Markup.button.callback('Cancelar', 'main_menu')]);
  await ctx.reply('¿Para qué día quieres modificar el pedido?', Markup.inlineKeyboard(buttons));
}

// ── Contact Madapan ───────────────────────────────────────────────────────────

export async function handleContactMadapan(ctx: BotContext): Promise<void> {
  await ctx.reply(
    'Contacto Madapan:\n\n• Teléfono: 722 833 052\n• Email: hola@madapan.es\n• Horario: de 9:00 a 14:00'
  );
}

// ── Add product ───────────────────────────────────────────────────────────────

export async function handleShowAddProduct(ctx: BotContext, dateStr: string): Promise<void> {
  const customer = await resolveCustomer(ctx);
  if (!customer) return;

  const order = await orderService.getOrderForDate(customer, dateStr);
  if (!order) {
    await ctx.reply(`No hay pedido para ${formatDateSpanish(dateStr)}.`);
    return;
  }

  ctx.session.selectedOrderId = order.id;
  ctx.session.selectedDate = dateStr;
  ctx.session.orderLines = order.lines.map(l => ({ id: l.id, name: l.name, units: l.units }));

  const skusEnPedido = new Set(order.lines.map(l => l.sku));
  const disponibles = catalogService.getAvailableProducts().filter(p => !skusEnPedido.has(p.sku));

  if (disponibles.length === 0) {
    await ctx.reply('Ya tienes todos los productos disponibles en el pedido.');
    return;
  }

  // Mostrar en grupos de 2 para que quepan bien
  const buttons: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let i = 0; i < disponibles.length; i += 2) {
    const row = [Markup.button.callback(disponibles[i].name, `ap|${disponibles[i].cod}`)];
    if (disponibles[i + 1]) row.push(Markup.button.callback(disponibles[i + 1].name, `ap|${disponibles[i + 1].cod}`));
    buttons.push(row);
  }
  buttons.push([Markup.button.callback('Cancelar', 'main_menu')]);

  await ctx.reply('¿Qué producto quieres añadir?', Markup.inlineKeyboard(buttons));
}

export async function handleAddProductSelected(ctx: BotContext, productCod: string): Promise<void> {
  const customer = await resolveCustomer(ctx);
  if (!customer) return;

  const dateStr = ctx.session.selectedDate;
  const orderId = ctx.session.selectedOrderId;
  if (!dateStr || !orderId) {
    await ctx.reply('Sesión expirada. Usa /hola para empezar.');
    return;
  }

  const product = catalogService.getProductByCod(productCod);
  if (!product) {
    await ctx.reply('Producto no encontrado.');
    return;
  }

  // Aviso si el producto necesita 24h y el pedido es para mañana (los admin pueden saltarlo)
  if (product.special24h && !ctx.session.isAdmin) {
    const tomorrow = getTomorrowDate();
    if (dateStr === tomorrow) {
      await ctx.reply(
        `⚠️ ${product.name} es un pan especial y necesita al menos 24 horas de antelación.\n\nNo se puede añadir para mañana. Si lo necesitas, contacta directamente con Madapan: 722 833 052.`,
        Markup.inlineKeyboard([[Markup.button.callback('Volver al menú', 'main_menu')]])
      );
      return;
    }
  }

  ctx.session.step = 'entering_exact';
  ctx.session.addingProduct = true;
  ctx.session.selectedLineId = productCod; // reutilizamos el campo para guardar el cod

  await ctx.reply(
    `${product.name}\n\n¿Cuántas unidades quieres añadir?`,
    Markup.inlineKeyboard([
      [
        Markup.button.callback('1', `apq|${productCod}|1`),
        Markup.button.callback('2', `apq|${productCod}|2`),
        Markup.button.callback('3', `apq|${productCod}|3`),
        Markup.button.callback('5', `apq|${productCod}|5`),
        Markup.button.callback('10', `apq|${productCod}|10`),
      ],
      [Markup.button.callback('Otra cantidad', `apq_manual|${productCod}`)],
      [Markup.button.callback('Cancelar', 'main_menu')],
    ])
  );
}

export async function handleAddProductQuantity(ctx: BotContext, productCod: string, units: number): Promise<void> {
  const customer = await resolveCustomer(ctx);
  if (!customer) return;

  const dateStr = ctx.session.selectedDate;
  const orderId = ctx.session.selectedOrderId;
  if (!dateStr || !orderId) {
    await ctx.reply('Sesión expirada.');
    return;
  }

  const order = await orderService.getOrderForDate(customer, dateStr);
  if (!order) {
    await ctx.reply('No se pudo cargar el pedido.');
    return;
  }

  ctx.session.step = 'idle';
  ctx.session.addingProduct = false;

  const result = await orderService.addProductToOrder(customer, order, productCod, units);
  await ctx.reply(result.message, Markup.inlineKeyboard([
    [Markup.button.callback('Añadir otro producto', `add_product|${dateStr}`)],
    [Markup.button.callback('Ver pedido actualizado', 'view_tomorrow')],
    [Markup.button.callback('Menú principal', 'main_menu')],
  ]));
}

// ── Cancel line ───────────────────────────────────────────────────────────────

export async function handleCancelLineConfirm(ctx: BotContext, lineIdx: number): Promise<void> {
  const sessionLine = ctx.session.orderLines?.[lineIdx];
  if (!sessionLine || !ctx.session.selectedOrderId || !ctx.session.selectedDate) {
    await ctx.reply('Sesión expirada. Usa /hola para empezar de nuevo.');
    return;
  }

  ctx.session.pendingCancelLineIdx = lineIdx;

  await ctx.reply(
    `¿Seguro que quieres eliminar "${sessionLine.name}" del pedido?`,
    Markup.inlineKeyboard([
      [
        Markup.button.callback('Sí, eliminar', `cancel_line_ok|${lineIdx}`),
        Markup.button.callback('No, volver', `product|${lineIdx}`),
      ],
    ])
  );
}

export async function handleCancelLine(ctx: BotContext, lineIdx: number): Promise<void> {
  const customer = await resolveCustomer(ctx);
  if (!customer) return;

  const sessionLine = ctx.session.orderLines?.[lineIdx];
  const dateStr = ctx.session.selectedDate;
  const orderId = ctx.session.selectedOrderId;

  if (!sessionLine || !dateStr || !orderId) {
    await ctx.reply('Sesión expirada. Usa /hola para empezar de nuevo.');
    return;
  }

  try {
    const order = await orderService.getOrderForDate(customer, dateStr);
    if (!order) {
      await ctx.reply('No se pudo cargar el pedido.');
      return;
    }

    const { removeLineFromOrder } = await import('../services/holdedClient');
    const result = await removeLineFromOrder(orderId, sessionLine.id, order);

    if (!result.success) {
      await ctx.reply('Error al eliminar el producto. Inténtalo de nuevo.');
      return;
    }

    // Eliminar de la sesión
    if (ctx.session.orderLines) {
      ctx.session.orderLines.splice(lineIdx, 1);
    }

    const { logChange } = await import('../utils/logger');
    logChange({
      timestamp: new Date().toISOString(),
      telegramId: customer.telegramId,
      customerName: customer.name,
      orderId,
      lineId: sessionLine.id,
      productName: sessionLine.name,
      sku: '',
      previousUnits: sessionLine.units,
      newUnits: 0,
      delta: -sessionLine.units,
      source: 'button',
      dryRun: (await import('../config')).config.dryRun,
    });

    await ctx.reply(
      `✓ "${sessionLine.name}" eliminado del pedido.`,
      Markup.inlineKeyboard([
        [Markup.button.callback('Ver pedido actualizado', `view_order|${dateStr}`)],
        [Markup.button.callback('Menú principal', 'main_menu')],
      ])
    );
  } catch (err) {
    warn('CustomerFlows', `handleCancelLine error: ${(err as Error).message}`);
    await ctx.reply('Error al eliminar el producto. Inténtalo de nuevo.');
  }
}

// ── Order history ─────────────────────────────────────────────────────────────

export async function handleOrderHistory(ctx: BotContext): Promise<void> {
  const customer = await resolveCustomer(ctx);
  if (!customer) return;

  try {
    const { listOrdersByContact } = await import('../services/holdedClient');
    const { formatDateSpanish } = await import('../utils/dates');
    const orders = await listOrdersByContact(customer.holdedContactId);

    if (orders.length === 0) {
      await ctx.reply('No se encontraron pedidos anteriores.');
      return;
    }

    // Ordenar por fecha descendente y tomar los últimos 7
    const sorted = [...orders]
      .filter(o => o.date)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 7);

    let text = `Últimos pedidos:\n\n`;
    for (const o of sorted) {
      const dateStr = typeof o.date === 'number'
        ? new Date(o.date * 1000).toISOString().split('T')[0]!
        : String(o.date).split('T')[0]!;
      const label = formatDateSpanish(dateStr);
      const nLines = Array.isArray(o.lines) ? o.lines.length : '?';
      text += `• ${label} — ${nLines} producto(s)\n`;
    }

    await ctx.reply(text, Markup.inlineKeyboard([
      [Markup.button.callback('Menú principal', 'main_menu')],
    ]));
  } catch (err) {
    warn('CustomerFlows', `handleOrderHistory error: ${(err as Error).message}`);
    await ctx.reply('Error al obtener el historial. Inténtalo de nuevo.');
  }
}

// ── Helper ────────────────────────────────────────────────────────────────────

async function resolveCustomer(ctx: BotContext): Promise<Customer | null> {
  const telegramId = String(ctx.from?.id ?? '');

  if (ctx.session.customer) return ctx.session.customer;

  const cached = clientCache.getClient(telegramId);
  if (cached) {
    ctx.session.customer = cached;
    return cached;
  }

  if (ctx.session.isAdmin || config.adminTelegramIds.includes(telegramId)) {
    ctx.session.isAdmin = true;
    await sendAdminMenu(ctx);
    return null;
  }

  // Usuario sin identificar → menú de bienvenida (pizza / identificarse)
  await sendWelcomeMenu(ctx);
  return null;
}
