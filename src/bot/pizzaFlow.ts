import { Markup } from 'telegraf';
import { Message } from 'telegraf/types';
import { BotContext } from './customerFlows';
import * as pizzaService from '../services/pizzaService';
import { sendToAdmin } from '../services/notifier';
import { log, warn } from '../utils/logger';
import { config } from '../config';

export interface PizzaSessionData {
  // Carrito: líneas ya confirmadas del pedido
  items: import('../services/pizzaService').PizzaOrderItem[];
  // Línea en construcción (aún no añadida al carrito)
  tipo?: 'individual' | 'menu';
  pizzaId?: string;
  postres?: string[];
  cantidad?: number;
  // Datos del pedido (una sola vez para todo el carrito)
  diaRecogida?: string;
  horaRecogida?: string;
  nombre?: string;
  telefono?: string;
  email?: string;
  marketingConsent?: boolean;
}

// Aviso de protección de datos mostrado antes de recoger datos personales.
function avisoProteccionDatos(): string {
  let t = 'ℹ️ Protección de datos\n\n' +
    'Para gestionar tu reserva, Madapan SL tratará tus datos (nombre, teléfono y email). ';
  if (config.privacyPolicyUrl) {
    t += `Puedes consultar cómo los usamos y ejercer tus derechos aquí:\n${config.privacyPolicyUrl}`;
  } else {
    t += 'Puedes consultar nuestra política de privacidad o escribirnos a hola@madapan.es.';
  }
  return t;
}

const HORAS = ['20:00', '20:30', '21:00', '21:30', '22:00', '22:30'];

// ── Entrada ───────────────────────────────────────────────────────────────────

export async function handlePizzaStart(ctx: BotContext): Promise<void> {
  const menu = pizzaService.getMenu();
  const restante = pizzaService.getRemainingStock();

  if (restante !== null && restante <= 0) {
    await ctx.reply('😔 Lo sentimos, no quedan pizzas disponibles para este fin de semana. ¡Prueba la semana que viene!');
    return;
  }

  ctx.session.pizzaOrder = { items: [] };
  ctx.session.step = 'idle';

  let text = `🍕 *Pizzas Madapan*\n\n`;
  text += `Disponibles ${menu.diasDisponibles.join(', ')} de ${menu.horaInicio} a ${menu.horaFin}\n\n`;
  for (const p of menu.pizzas) {
    text += `*${p.name}*\n  ${p.ingredientes.join(', ')}\n\n`;
  }
  text += `Precio individual: ${menu.precioIndividual} €\n`;
  text += `Menú Pizza Madapan: ${menu.precioMenu} € (${menu.menuIncluye})\n\n`;
  if (restante !== null) text += `Quedan ${restante} unidades disponibles este fin de semana.\n\n`;
  text += `¿Qué quieres pedir?`;

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('Pizza individual', 'pz_tipo|individual')],
      [Markup.button.callback('Menú Pizza Madapan', 'pz_tipo|menu')],
      [Markup.button.callback('Cancelar', 'main_menu')],
    ]),
  });
}

// Muestra los botones de tipo de pizza (usado al empezar y al "añadir otra")
async function pedirTipo(ctx: BotContext): Promise<void> {
  await ctx.reply(
    '¿Qué quieres añadir?',
    Markup.inlineKeyboard([
      [Markup.button.callback('Pizza individual', 'pz_tipo|individual')],
      [Markup.button.callback('Menú Pizza Madapan', 'pz_tipo|menu')],
      [Markup.button.callback('Cancelar', 'main_menu')],
    ])
  );
}

export async function handlePizzaTipoElegido(ctx: BotContext, tipo: 'individual' | 'menu'): Promise<void> {
  ctx.session.pizzaOrder = { ...(ctx.session.pizzaOrder ?? { items: [] }), tipo };
  const menu = pizzaService.getMenu();
  const buttons = menu.pizzas.map(p => [Markup.button.callback(p.name, `pz_pizza|${p.id}`)]);
  buttons.push([Markup.button.callback('Cancelar', 'main_menu')]);
  await ctx.reply('¿Qué pizza eliges?', Markup.inlineKeyboard(buttons));
}

export async function handlePizzaElegida(ctx: BotContext, pizzaId: string): Promise<void> {
  const pizza = pizzaService.getPizzaById(pizzaId);
  if (!pizza) {
    await ctx.reply('Pizza no encontrada.');
    return;
  }
  ctx.session.pizzaOrder = { ...(ctx.session.pizzaOrder ?? { items: [] }), pizzaId, postres: [] };

  if (ctx.session.pizzaOrder!.tipo === 'menu') {
    await pedirPostre(ctx, 1);
    return;
  }

  await pedirCantidad(ctx);
}

async function pedirPostre(ctx: BotContext, numero: 1 | 2): Promise<void> {
  const menu = pizzaService.getMenu();
  const buttons = menu.postres.map(p => [Markup.button.callback(p.name, `pz_postre|${numero}|${p.id}`)]);
  await ctx.reply(`Elige el vasito de postre ${numero} de 2:`, Markup.inlineKeyboard(buttons));
}

export async function handlePizzaPostreElegido(ctx: BotContext, numero: number, postreId: string): Promise<void> {
  const postre = pizzaService.getPostreById(postreId);
  if (!postre || !ctx.session.pizzaOrder) {
    await ctx.reply('Sesión expirada. Escribe /pizza para empezar de nuevo.');
    return;
  }
  ctx.session.pizzaOrder.postres = [...(ctx.session.pizzaOrder.postres ?? []), postre.name];

  if (numero === 1) {
    await pedirPostre(ctx, 2);
    return;
  }

  await pedirCantidad(ctx);
}

async function pedirCantidad(ctx: BotContext): Promise<void> {
  await ctx.reply(
    '¿Cuántas quieres?',
    Markup.inlineKeyboard([
      [
        Markup.button.callback('1', 'pz_cant|1'),
        Markup.button.callback('2', 'pz_cant|2'),
        Markup.button.callback('3', 'pz_cant|3'),
        Markup.button.callback('4', 'pz_cant|4'),
      ],
    ])
  );
}

export async function handlePizzaCantidadElegida(ctx: BotContext, cantidad: number): Promise<void> {
  const order = ctx.session.pizzaOrder;
  if (!order) {
    await ctx.reply('Sesión expirada. Escribe /pizza para empezar de nuevo.');
    return;
  }
  order.cantidad = cantidad;
  pushCurrentItem(order);
  await preguntarAnadirMas(ctx);
}

// Añade la línea en construcción al carrito y limpia los campos temporales.
function pushCurrentItem(order: PizzaSessionData): void {
  if (!order.tipo || !order.pizzaId || !order.cantidad) return;
  const pizza = pizzaService.getPizzaById(order.pizzaId);
  const menu = pizzaService.getMenu();
  const precioUnidad = order.tipo === 'menu' ? menu.precioMenu : menu.precioIndividual;
  order.items.push({
    tipo: order.tipo,
    pizzaId: order.pizzaId,
    pizzaName: pizza?.name ?? order.pizzaId,
    postres: order.postres ?? [],
    cantidad: order.cantidad,
    precioUnidad,
  });
  order.tipo = undefined;
  order.pizzaId = undefined;
  order.postres = undefined;
  order.cantidad = undefined;
}

// Muestra el carrito actual y ofrece añadir otra pizza o continuar.
async function preguntarAnadirMas(ctx: BotContext): Promise<void> {
  const order = ctx.session.pizzaOrder!;
  const resumen = pizzaService.itemsLabel(order.items);
  await ctx.reply(
    `🛒 Tu pedido: ${resumen}\n\n¿Quieres añadir otra pizza o continuar con la recogida?`,
    Markup.inlineKeyboard([
      [Markup.button.callback('➕ Añadir otra pizza', 'pz_mas')],
      [Markup.button.callback('✅ Continuar con la recogida', 'pz_seguir')],
    ])
  );
}

// "Añadir otra pizza" → vuelve a la selección de tipo
export async function handlePizzaMas(ctx: BotContext): Promise<void> {
  if (!ctx.session.pizzaOrder) {
    await ctx.reply('Sesión expirada. Escribe /pizza para empezar de nuevo.');
    return;
  }
  await pedirTipo(ctx);
}

// "Continuar con la recogida" → pide el día
export async function handlePizzaSeguir(ctx: BotContext): Promise<void> {
  const order = ctx.session.pizzaOrder;
  if (!order || order.items.length === 0) {
    await ctx.reply('Sesión expirada. Escribe /pizza para empezar de nuevo.');
    return;
  }
  const menu = pizzaService.getMenu();
  const buttons = menu.diasDisponibles.map(d => [Markup.button.callback(d, `pz_dia|${d}`)]);
  await ctx.reply('¿Qué día quieres recogerlo?', Markup.inlineKeyboard(buttons));
}

export async function handlePizzaDiaElegido(ctx: BotContext, dia: string): Promise<void> {
  if (!ctx.session.pizzaOrder) {
    await ctx.reply('Sesión expirada. Escribe /pizza para empezar de nuevo.');
    return;
  }
  ctx.session.pizzaOrder.diaRecogida = dia;

  const buttons: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let i = 0; i < HORAS.length; i += 3) {
    buttons.push(HORAS.slice(i, i + 3).map(h => Markup.button.callback(h, `pz_hora|${h}`)));
  }
  await ctx.reply('¿A qué hora la recoges?', Markup.inlineKeyboard(buttons));
}

export async function handlePizzaHoraElegida(ctx: BotContext, hora: string): Promise<void> {
  if (!ctx.session.pizzaOrder) {
    await ctx.reply('Sesión expirada. Escribe /pizza para empezar de nuevo.');
    return;
  }
  ctx.session.pizzaOrder.horaRecogida = hora;
  ctx.session.step = 'pizza_awaiting_name';
  await ctx.reply(avisoProteccionDatos());
  await ctx.reply('¿A nombre de quién hacemos la reserva? Escribe tu nombre:');
}

// ── Texto: nombre, teléfono, email ────────────────────────────────────────────

export async function handlePizzaText(ctx: BotContext): Promise<boolean> {
  if (!ctx.message || !('text' in ctx.message)) return false;
  const text = (ctx.message as Message.TextMessage).text.trim();
  const order = ctx.session.pizzaOrder;

  if (ctx.session.step === 'pizza_awaiting_name') {
    if (!order) {
      await ctx.reply('Sesión expirada. Escribe /pizza para empezar de nuevo.');
      ctx.session.step = 'idle';
      return true;
    }
    order.nombre = text;
    ctx.session.step = 'pizza_awaiting_phone';
    await ctx.reply('¿Tu teléfono de contacto?');
    return true;
  }

  if (ctx.session.step === 'pizza_awaiting_phone') {
    if (!order) return true;
    order.telefono = text;
    ctx.session.step = 'pizza_awaiting_email';
    await ctx.reply('¿Tu email?');
    return true;
  }

  if (ctx.session.step === 'pizza_awaiting_email') {
    if (!order) return true;
    order.email = text;
    ctx.session.step = 'pizza_awaiting_marketing';
    await ctx.reply(
      '¿Quieres recibir promociones y novedades de Madapan por email? Es opcional; podrás darte de baja cuando quieras.',
      Markup.inlineKeyboard([
        [Markup.button.callback('✅ Sí, quiero recibir promociones', 'pz_promo|si')],
        [Markup.button.callback('No, gracias', 'pz_promo|no')],
      ])
    );
    return true;
  }

  return false;
}

// Registra la respuesta al consentimiento de marketing y finaliza el pedido.
export async function handlePizzaMarketing(ctx: BotContext, consent: boolean): Promise<void> {
  const order = ctx.session.pizzaOrder;
  if (!order || !order.email) {
    ctx.session.step = 'idle';
    await ctx.reply('Sesión expirada. Escribe /pizza para empezar de nuevo.');
    return;
  }
  order.marketingConsent = consent;
  await ctx.reply(consent
    ? '¡Gracias! Te mantendremos al día de nuestras novedades. 🙌'
    : 'Perfecto, solo usaremos tus datos para gestionar esta reserva.');
  await confirmarPedido(ctx, order.email);
}

async function confirmarPedido(ctx: BotContext, email: string): Promise<void> {
  const order = ctx.session.pizzaOrder;
  ctx.session.step = 'idle';

  if (!order || order.items.length === 0 || !order.diaRecogida || !order.horaRecogida || !order.nombre || !order.telefono) {
    await ctx.reply('Faltan datos del pedido. Escribe /pizza para empezar de nuevo.');
    return;
  }

  const cantidadTotal = order.items.reduce((s, i) => s + i.cantidad, 0);
  const precioTotal = order.items.reduce((s, i) => s + i.precioUnidad * i.cantidad, 0);

  const ok = pizzaService.consumeStock(cantidadTotal);
  if (!ok) {
    await ctx.reply('😔 Lo sentimos, no queda stock suficiente para esa cantidad. Prueba con menos unidades o contacta con Madapan: 722 833 052.');
    return;
  }

  const telegramId = String(ctx.from?.id ?? '');

  const orderNumber = pizzaService.logPizzaOrder({
    timestamp: new Date().toISOString(),
    telegramId,
    nombre: order.nombre,
    telefono: order.telefono,
    email,
    marketingConsent: order.marketingConsent ?? false,
    items: order.items,
    cantidadTotal,
    precioTotal,
    diaRecogida: order.diaRecogida,
    horaRecogida: order.horaRecogida,
  });

  log('PizzaFlow', `Reserva de pizza ${orderNumber}: ${order.nombre} — ${pizzaService.itemsLabel(order.items)} (${order.diaRecogida} ${order.horaRecogida})`);

  const lineasTexto = order.items
    .map(it => {
      let l = `${it.cantidad}x ${it.tipo === 'menu' ? 'Menú ' : ''}${it.pizzaName}`;
      if (it.postres.length > 0) l += ` (postres: ${it.postres.join(', ')})`;
      return l;
    })
    .join('\n');

  let resumen = `✅ ¡Reserva confirmada!\n\n`;
  resumen += `Número de pedido: ${orderNumber}\n\n`;
  resumen += `${lineasTexto}\n`;
  resumen += `Recogida: ${order.diaRecogida} a las ${order.horaRecogida}\n`;
  resumen += `Total: ${precioTotal.toFixed(2)} €\n\n`;
  resumen += `Pago en el local al recoger. ¡Te esperamos! 🍕`;

  await ctx.reply(resumen);

  const avisoAdmin =
    `🍕 Nueva reserva de pizza — ${orderNumber}\n\n` +
    `👤 ${order.nombre} — ${order.telefono} — ${email}\n` +
    `${lineasTexto}\n` +
    `Recogida: ${order.diaRecogida} a las ${order.horaRecogida}\n` +
    `Total: ${precioTotal.toFixed(2)} €\n` +
    `📧 Marketing: ${order.marketingConsent ? 'SÍ acepta promociones' : 'no'}`;

  sendToAdmin(avisoAdmin).catch(err => warn('PizzaFlow', `Error notificando a admin: ${(err as Error).message}`));

  ctx.session.pizzaOrder = undefined;
}

// ── Cancelación de reservas ───────────────────────────────────────────────────

function isStaffUser(ctx: BotContext): boolean {
  return config.adminTelegramIds.includes(String(ctx.from?.id ?? ''));
}

// El admin puede cancelar cualquier reserva; el cliente solo la suya.
function puedeCancelar(ctx: BotContext, o: pizzaService.PizzaOrderEntry): boolean {
  return isStaffUser(ctx) || o.telegramId === String(ctx.from?.id ?? '');
}

// Cliente: lista sus reservas activas del finde para cancelar.
export async function handlePizzaCancelMine(ctx: BotContext): Promise<void> {
  const telegramId = String(ctx.from?.id ?? '');
  const orders = pizzaService.getActiveOrdersByTelegramId(telegramId);
  if (orders.length === 0) {
    await ctx.reply('No tienes reservas de pizza activas este fin de semana.');
    return;
  }
  const buttons = orders.map(o => [Markup.button.callback(
    `${o.orderNumber} · ${o.diaRecogida} ${o.horaRecogida} · ${o.cantidadTotal} ud(s)`,
    `pz_cancel|${o.orderNumber}`,
  )]);
  await ctx.reply('¿Qué reserva quieres cancelar?', Markup.inlineKeyboard(buttons));
}

// Admin: lista todas las reservas activas del finde para cancelar.
export async function handleAdminCancelPizza(ctx: BotContext): Promise<void> {
  const orders = pizzaService.getActiveOrdersForWeek();
  if (orders.length === 0) {
    await ctx.reply('No hay reservas de pizza activas este fin de semana.');
    return;
  }
  const buttons = orders.map(o => [Markup.button.callback(
    `${o.orderNumber} · ${o.nombre} · ${o.diaRecogida} ${o.horaRecogida}`,
    `pz_cancel|${o.orderNumber}`,
  )]);
  await ctx.reply('Selecciona la reserva a cancelar:', Markup.inlineKeyboard(buttons));
}

// Paso de confirmación antes de cancelar.
export async function handlePizzaCancelPrompt(ctx: BotContext, orderNumber: string): Promise<void> {
  const o = pizzaService.getOrderByNumber(orderNumber);
  if (!o || o.cancelled) {
    await ctx.reply('Esa reserva ya no está disponible.');
    return;
  }
  if (!puedeCancelar(ctx, o)) {
    await ctx.reply('No tienes permiso para cancelar esta reserva.');
    return;
  }
  await ctx.reply(
    `¿Seguro que quieres cancelar ${o.orderNumber}?\n${pizzaService.itemsLabel(o.items)} — ${o.diaRecogida} ${o.horaRecogida}`,
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ Sí, cancelar', `pz_cancel_ok|${o.orderNumber}`)],
      [Markup.button.callback('No, volver', 'main_menu')],
    ])
  );
}

// Ejecuta la cancelación (con control de permisos) y avisa a administración.
export async function handlePizzaCancelConfirm(ctx: BotContext, orderNumber: string): Promise<void> {
  const existing = pizzaService.getOrderByNumber(orderNumber);
  if (!existing || existing.cancelled) {
    await ctx.reply('Esa reserva ya no está disponible.');
    return;
  }
  if (!puedeCancelar(ctx, existing)) {
    await ctx.reply('No tienes permiso para cancelar esta reserva.');
    return;
  }

  const staff = isStaffUser(ctx);
  const cancelledBy = staff ? `admin:${ctx.from?.id}` : String(ctx.from?.id ?? '');
  const cancelled = pizzaService.cancelOrder(orderNumber, cancelledBy);
  if (!cancelled) {
    await ctx.reply('No se ha podido cancelar (puede que ya estuviera cancelada).');
    return;
  }

  await ctx.reply(`✅ Reserva ${orderNumber} cancelada. El stock se ha liberado.`);

  const aviso =
    `❌ Reserva cancelada — ${orderNumber}\n\n` +
    `👤 ${cancelled.nombre} (${cancelled.telefono})\n` +
    `${pizzaService.itemsLabel(cancelled.items)}\n` +
    `Recogida: ${cancelled.diaRecogida} ${cancelled.horaRecogida}\n` +
    `Cancelada por: ${staff ? 'administración' : 'el cliente'}`;
  sendToAdmin(aviso).catch(err => warn('PizzaFlow', `Error notificando cancelación: ${(err as Error).message}`));
}
