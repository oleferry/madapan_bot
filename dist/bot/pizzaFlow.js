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
exports.handlePizzaStart = handlePizzaStart;
exports.handlePizzaTipoElegido = handlePizzaTipoElegido;
exports.handlePizzaElegida = handlePizzaElegida;
exports.handlePizzaPostreElegido = handlePizzaPostreElegido;
exports.handlePizzaCantidadElegida = handlePizzaCantidadElegida;
exports.handlePizzaDiaElegido = handlePizzaDiaElegido;
exports.handlePizzaHoraElegida = handlePizzaHoraElegida;
exports.handlePizzaText = handlePizzaText;
exports.handlePizzaMarketing = handlePizzaMarketing;
const telegraf_1 = require("telegraf");
const pizzaService = __importStar(require("../services/pizzaService"));
const notifier_1 = require("../services/notifier");
const logger_1 = require("../utils/logger");
const config_1 = require("../config");
// Aviso de protección de datos mostrado antes de recoger datos personales.
function avisoProteccionDatos() {
    let t = 'ℹ️ Protección de datos\n\n' +
        'Para gestionar tu reserva, Madapan SL tratará tus datos (nombre, teléfono y email). ';
    if (config_1.config.privacyPolicyUrl) {
        t += `Puedes consultar cómo los usamos y ejercer tus derechos aquí:\n${config_1.config.privacyPolicyUrl}`;
    }
    else {
        t += 'Puedes consultar nuestra política de privacidad o escribirnos a hola@madapan.es.';
    }
    return t;
}
const HORAS = ['20:00', '20:30', '21:00', '21:30', '22:00', '22:30'];
// ── Entrada ───────────────────────────────────────────────────────────────────
async function handlePizzaStart(ctx) {
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
    if (restante !== null)
        text += `Quedan ${restante} unidades disponibles este fin de semana.\n\n`;
    text += `¿Qué quieres pedir?`;
    await ctx.reply(text, {
        parse_mode: 'Markdown',
        ...telegraf_1.Markup.inlineKeyboard([
            [telegraf_1.Markup.button.callback('Pizza individual', 'pz_tipo|individual')],
            [telegraf_1.Markup.button.callback('Menú Pizza Madapan', 'pz_tipo|menu')],
            [telegraf_1.Markup.button.callback('Cancelar', 'main_menu')],
        ]),
    });
}
async function handlePizzaTipoElegido(ctx, tipo) {
    ctx.session.pizzaOrder = { ...ctx.session.pizzaOrder, tipo };
    const menu = pizzaService.getMenu();
    const buttons = menu.pizzas.map(p => [telegraf_1.Markup.button.callback(p.name, `pz_pizza|${p.id}`)]);
    buttons.push([telegraf_1.Markup.button.callback('Cancelar', 'main_menu')]);
    await ctx.reply('¿Qué pizza eliges?', telegraf_1.Markup.inlineKeyboard(buttons));
}
async function handlePizzaElegida(ctx, pizzaId) {
    const pizza = pizzaService.getPizzaById(pizzaId);
    if (!pizza) {
        await ctx.reply('Pizza no encontrada.');
        return;
    }
    ctx.session.pizzaOrder = { ...ctx.session.pizzaOrder, pizzaId, postres: [] };
    if (ctx.session.pizzaOrder.tipo === 'menu') {
        await pedirPostre(ctx, 1);
        return;
    }
    await pedirCantidad(ctx);
}
async function pedirPostre(ctx, numero) {
    const menu = pizzaService.getMenu();
    const buttons = menu.postres.map(p => [telegraf_1.Markup.button.callback(p.name, `pz_postre|${numero}|${p.id}`)]);
    await ctx.reply(`Elige el vasito de postre ${numero} de 2:`, telegraf_1.Markup.inlineKeyboard(buttons));
}
async function handlePizzaPostreElegido(ctx, numero, postreId) {
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
async function pedirCantidad(ctx) {
    await ctx.reply('¿Cuántas quieres?', telegraf_1.Markup.inlineKeyboard([
        [
            telegraf_1.Markup.button.callback('1', 'pz_cant|1'),
            telegraf_1.Markup.button.callback('2', 'pz_cant|2'),
            telegraf_1.Markup.button.callback('3', 'pz_cant|3'),
            telegraf_1.Markup.button.callback('4', 'pz_cant|4'),
        ],
    ]));
}
async function handlePizzaCantidadElegida(ctx, cantidad) {
    if (!ctx.session.pizzaOrder) {
        await ctx.reply('Sesión expirada. Escribe /pizza para empezar de nuevo.');
        return;
    }
    ctx.session.pizzaOrder.cantidad = cantidad;
    const menu = pizzaService.getMenu();
    const buttons = menu.diasDisponibles.map(d => [telegraf_1.Markup.button.callback(d, `pz_dia|${d}`)]);
    await ctx.reply('¿Qué día quieres recogerla?', telegraf_1.Markup.inlineKeyboard(buttons));
}
async function handlePizzaDiaElegido(ctx, dia) {
    if (!ctx.session.pizzaOrder) {
        await ctx.reply('Sesión expirada. Escribe /pizza para empezar de nuevo.');
        return;
    }
    ctx.session.pizzaOrder.diaRecogida = dia;
    const buttons = [];
    for (let i = 0; i < HORAS.length; i += 3) {
        buttons.push(HORAS.slice(i, i + 3).map(h => telegraf_1.Markup.button.callback(h, `pz_hora|${h}`)));
    }
    await ctx.reply('¿A qué hora la recoges?', telegraf_1.Markup.inlineKeyboard(buttons));
}
async function handlePizzaHoraElegida(ctx, hora) {
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
async function handlePizzaText(ctx) {
    if (!ctx.message || !('text' in ctx.message))
        return false;
    const text = ctx.message.text.trim();
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
        if (!order)
            return true;
        order.telefono = text;
        ctx.session.step = 'pizza_awaiting_email';
        await ctx.reply('¿Tu email?');
        return true;
    }
    if (ctx.session.step === 'pizza_awaiting_email') {
        if (!order)
            return true;
        order.email = text;
        ctx.session.step = 'pizza_awaiting_marketing';
        await ctx.reply('¿Quieres recibir promociones y novedades de Madapan por email? Es opcional; podrás darte de baja cuando quieras.', telegraf_1.Markup.inlineKeyboard([
            [telegraf_1.Markup.button.callback('✅ Sí, quiero recibir promociones', 'pz_promo|si')],
            [telegraf_1.Markup.button.callback('No, gracias', 'pz_promo|no')],
        ]));
        return true;
    }
    return false;
}
// Registra la respuesta al consentimiento de marketing y finaliza el pedido.
async function handlePizzaMarketing(ctx, consent) {
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
async function confirmarPedido(ctx, email) {
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
        tipo: order.tipo,
        pizzaId: order.pizzaId,
        pizzaName: pizza.name,
        postres: order.postres ?? [],
        cantidad: order.cantidad,
        diaRecogida: order.diaRecogida,
        horaRecogida: order.horaRecogida,
        precioTotal,
    });
    (0, logger_1.log)('PizzaFlow', `Reserva de pizza: ${order.nombre} — ${order.cantidad}x ${pizza.name} (${order.diaRecogida} ${order.horaRecogida})`);
    let resumen = `✅ ¡Reserva confirmada!\n\n`;
    resumen += `${order.cantidad}x ${order.tipo === 'menu' ? 'Menú ' : ''}${pizza.name}\n`;
    if (order.postres && order.postres.length > 0)
        resumen += `Postres: ${order.postres.join(', ')}\n`;
    resumen += `Recogida: ${order.diaRecogida} a las ${order.horaRecogida}\n`;
    resumen += `Total: ${precioTotal.toFixed(2)} €\n\n`;
    resumen += `Pago en el local al recoger. ¡Te esperamos! 🍕`;
    await ctx.reply(resumen);
    const avisoAdmin = `🍕 Nueva reserva de pizza\n\n` +
        `👤 ${order.nombre} — ${order.telefono} — ${email}\n` +
        `${order.cantidad}x ${order.tipo === 'menu' ? 'Menú ' : ''}${pizza.name}\n` +
        (order.postres && order.postres.length > 0 ? `Postres: ${order.postres.join(', ')}\n` : '') +
        `Recogida: ${order.diaRecogida} a las ${order.horaRecogida}\n` +
        `Total: ${precioTotal.toFixed(2)} €\n` +
        `📧 Marketing: ${order.marketingConsent ? 'SÍ acepta promociones' : 'no'}`;
    (0, notifier_1.sendToAdmin)(avisoAdmin).catch(err => (0, logger_1.warn)('PizzaFlow', `Error notificando a admin: ${err.message}`));
    ctx.session.pizzaOrder = undefined;
}
//# sourceMappingURL=pizzaFlow.js.map