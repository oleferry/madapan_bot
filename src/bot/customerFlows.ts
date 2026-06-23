import { Context, Markup } from 'telegraf';
import { Message } from 'telegraf/types';
import { Customer } from '../types';
import * as orderService from '../services/orderService';
import * as clientCache from '../services/clientCache';
import * as catalogService from '../services/catalogService';
import { parseCustomerMessage } from '../services/messageParser';
import { getTomorrowDate, formatDateSpanish, getCurrentWeekDates } from '../utils/dates';
import { log, warn } from '../utils/logger';

// ── Session ───────────────────────────────────────────────────────────────────

export interface SessionData {
  step: 'idle' | 'awaiting_phone' | 'selecting_product' | 'selecting_day' | 'entering_exact';
  selectedDate?: string;
  selectedOrderId?: string;
  selectedLineId?: string;
  selectedLineName?: string;
  selectedLineCurrentUnits?: number;
  customer?: Customer;
  // líneas del pedido actual guardadas en sesión para evitar IDs largos en botones
  orderLines?: Array<{ id: string; name: string; units: number }>;
  addingProduct?: boolean;
}

export type BotContext = Context & { session: SessionData };

// ── /start ────────────────────────────────────────────────────────────────────

export async function handleStart(ctx: BotContext): Promise<void> {
  const telegramId = String(ctx.from?.id ?? '');

  try {
    const cached = clientCache.getClient(telegramId);
    if (cached) {
      ctx.session.customer = cached;
      ctx.session.step = 'idle';
      await sendMainMenu(ctx, cached.name);
      return;
    }

    ctx.session.step = 'awaiting_phone';
    await ctx.reply(
      'Hola! Soy el bot de Madapan 🥖\n\nDesde aquí puedes consultar y modificar las cantidades de tus pedidos.\n\n⚠️ Los panes especiales (centeno, semillas, integral, pasas y nueces) necesitan al menos 24 horas de antelación — no se pueden añadir para el día siguiente.\n\nPara empezar, escribe tu NIF o CIF:',
      Markup.removeKeyboard()
    );
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
      [Markup.button.callback('Contactar con Madapan', 'contact_madapan')],
    ])
  );
}

export async function handleMainMenu(ctx: BotContext): Promise<void> {
  const customer = await resolveCustomer(ctx);
  if (!customer) return;
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
      [Markup.button.callback('Cancelar', 'main_menu')],
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

    const customer = await resolveCustomer(ctx);
    if (!customer) {
      // Cliente nuevo — arrancar registro automáticamente sin necesidad de comando
      ctx.session.step = 'awaiting_phone';
      await ctx.reply(
        'Hola! Soy el bot de Madapan 🥖\n\nDesde aquí puedes consultar y modificar las cantidades de tus pedidos.\n\n⚠️ Los panes especiales (centeno, semillas, integral, pasas y nueces) necesitan al menos 24 horas de antelación — no se pueden añadir para el día siguiente.\n\nPara empezar, escribe tu NIF o CIF:',
        Markup.removeKeyboard()
      );
      return;
    }

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

  // Aviso si el producto necesita 24h y el pedido es para mañana
  if (product.special24h) {
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

// ── Helper ────────────────────────────────────────────────────────────────────

async function resolveCustomer(ctx: BotContext): Promise<Customer | null> {
  const telegramId = String(ctx.from?.id ?? '');

  if (ctx.session.customer) return ctx.session.customer;

  const cached = clientCache.getClient(telegramId);
  if (cached) {
    ctx.session.customer = cached;
    return cached;
  }

  await ctx.reply('No estás registrado. Usa /start para comenzar.');
  return null;
}
