import { Markup } from 'telegraf';
import { Message } from 'telegraf/types';
import { BotContext } from './customerFlows';
import * as pizzaService from '../services/pizzaService';
import { sendToAdmin } from '../services/notifier';
import { log, warn } from '../utils/logger';
import { config } from '../config';

export interface PizzaSessionData {
  tipo?: 'individual' | 'menu';
  pizzaId?: string;
  postres?: string[];
  cantidad?: number;
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

  ctx.session.pizzaOrder = {};
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

export async function handlePizzaTipoElegido(ctx: BotContext, tipo: 'individual' | 'menu'): Promise<void> {
  ctx.session.pizzaOrder = { ...ctx.session.pizzaOrder, tipo };
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
  ctx.session.pizzaOrder = { ...ctx.session.pizzaOrder, pizzaId, postres: [] };

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
  if (!ctx.session.pizzaOrder) {
    await ctx.reply('Sesión expirada. Escribe /pizza para empezar de nuevo.');
    return;
  }
  ctx.session.pizzaOrder.cantidad = cantidad;

  const menu = pizzaService.getMenu();
  const buttons = menu.diasDisponibles.map(d => [Markup.button.callback(d, `pz_dia|${d}`)]);
  await ctx.reply('¿Qué día quieres recogerla?', Markup.inlineKeyboard(buttons));
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

  if (!order || !order.pizzaId || !order.cantidad || !order.diaRecogida || !order.horaRecogida || !order.nombre || !order.telefono) {
    await ctx.reply('Faltan datos del pedido. Escribe /pizza para empezar de nuevo.');
    return;
  }

  const pizza = pizzaService.getPizzaById(order.pizzaId);
  if (!pizza) {
    await ctx.reply('Error interno. Escribe /pizza para empezar de nuevo.');
    return;
  }

  const menu = pizzaService.getMenu();
  const precioUnidad = order.tipo === 'menu' ? menu.precioMenu : menu.precioIndividual;
  const precioTotal = precioUnidad * order.cantidad;

  const ok = pizzaService.consumeStock(order.cantidad);
  if (!ok) {
    await ctx.reply('😔 Lo sentimos, no queda stock suficiente para esa cantidad. Prueba con menos unidades o contacta con Madapan: 722 833 052.');
    return;
  }

  const telegramId = String(ctx.from?.id ?? '');

  pizzaService.logPizzaOrder({
    timestamp: new Date().toISOString(),
    telegramId,
    nombre: order.nombre,
    telefono: order.telefono,
    email,
    marketingConsent: order.marketingConsent ?? false,
    tipo: order.tipo!,
    pizzaId: order.pizzaId,
    pizzaName: pizza.name,
    postres: order.postres ?? [],
    cantidad: order.cantidad,
    diaRecogida: order.diaRecogida,
    horaRecogida: order.horaRecogida,
    precioTotal,
  });

  log('PizzaFlow', `Reserva de pizza: ${order.nombre} — ${order.cantidad}x ${pizza.name} (${order.diaRecogida} ${order.horaRecogida})`);

  let resumen = `✅ ¡Reserva confirmada!\n\n`;
  resumen += `${order.cantidad}x ${order.tipo === 'menu' ? 'Menú ' : ''}${pizza.name}\n`;
  if (order.postres && order.postres.length > 0) resumen += `Postres: ${order.postres.join(', ')}\n`;
  resumen += `Recogida: ${order.diaRecogida} a las ${order.horaRecogida}\n`;
  resumen += `Total: ${precioTotal.toFixed(2)} €\n\n`;
  resumen += `Pago en el local al recoger. ¡Te esperamos! 🍕`;

  await ctx.reply(resumen);

  const avisoAdmin =
    `🍕 Nueva reserva de pizza\n\n` +
    `👤 ${order.nombre} — ${order.telefono} — ${email}\n` +
    `${order.cantidad}x ${order.tipo === 'menu' ? 'Menú ' : ''}${pizza.name}\n` +
    (order.postres && order.postres.length > 0 ? `Postres: ${order.postres.join(', ')}\n` : '') +
    `Recogida: ${order.diaRecogida} a las ${order.horaRecogida}\n` +
    `Total: ${precioTotal.toFixed(2)} €\n` +
    `📧 Marketing: ${order.marketingConsent ? 'SÍ acepta promociones' : 'no'}`;

  sendToAdmin(avisoAdmin).catch(err => warn('PizzaFlow', `Error notificando a admin: ${(err as Error).message}`));

  ctx.session.pizzaOrder = undefined;
}
