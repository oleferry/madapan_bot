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
exports.handleStart = handleStart;
exports.handleContact = handleContact;
exports.handleIdentifyClient = handleIdentifyClient;
exports.handleMainMenu = handleMainMenu;
exports.handleAdminSelectClient = handleAdminSelectClient;
exports.handleAdminByNif = handleAdminByNif;
exports.handleAdminClientChosen = handleAdminClientChosen;
exports.handleAdminPizzaStockPrompt = handleAdminPizzaStockPrompt;
exports.handleAdminPizzaPedidos = handleAdminPizzaPedidos;
exports.handleViewOrder = handleViewOrder;
exports.handleChangeOrder = handleChangeOrder;
exports.handleProductSelected = handleProductSelected;
exports.handleQuantityButton = handleQuantityButton;
exports.handleExactQuantity = handleExactQuantity;
exports.handleText = handleText;
exports.handleDaySelection = handleDaySelection;
exports.handleContactMadapan = handleContactMadapan;
exports.handleShowAddProduct = handleShowAddProduct;
exports.handleAddProductSelected = handleAddProductSelected;
exports.handleAddProductQuantity = handleAddProductQuantity;
exports.handleCancelLineConfirm = handleCancelLineConfirm;
exports.handleCancelLine = handleCancelLine;
exports.handleOrderHistory = handleOrderHistory;
const telegraf_1 = require("telegraf");
const orderService = __importStar(require("../services/orderService"));
const clientCache = __importStar(require("../services/clientCache"));
const catalogService = __importStar(require("../services/catalogService"));
const messageParser_1 = require("../services/messageParser");
const dates_1 = require("../utils/dates");
const logger_1 = require("../utils/logger");
const config_1 = require("../config");
// ── /start ────────────────────────────────────────────────────────────────────
function isAdmin(ctx) {
    const telegramId = String(ctx.from?.id ?? '');
    return config_1.config.adminTelegramIds.includes(telegramId);
}
async function handleStart(ctx) {
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
    }
    catch (err) {
        (0, logger_1.warn)('CustomerFlows', `handleStart error: ${err.message}`);
        await ctx.reply('Ha ocurrido un error. Por favor inténtalo de nuevo más tarde.');
    }
}
// ── Contact received ──────────────────────────────────────────────────────────
async function handleContact(ctx) {
    const telegramId = String(ctx.from?.id ?? '');
    const contact = ctx.message?.contact;
    if (!contact?.phone_number) {
        await ctx.reply('No he podido leer tu número. Por favor intenta de nuevo con /start.');
        return;
    }
    try {
        const customer = await orderService.getOrRegisterCustomer(telegramId, contact.phone_number);
        if (!customer) {
            await ctx.reply('No estás registrado en Madapan. Contacta con nosotros.', telegraf_1.Markup.removeKeyboard());
            return;
        }
        ctx.session.customer = customer;
        ctx.session.step = 'idle';
        (0, logger_1.log)('CustomerFlows', `Registered customer ${customer.name} (${telegramId})`);
        await ctx.reply(`Bienvenido, ${customer.name}!`, telegraf_1.Markup.removeKeyboard());
        await sendMainMenu(ctx, customer.name);
    }
    catch (err) {
        (0, logger_1.warn)('CustomerFlows', `handleContact error: ${err.message}`);
        await ctx.reply('Error al verificar tu teléfono. Inténtalo de nuevo.');
    }
}
// ── Main menu ─────────────────────────────────────────────────────────────────
async function sendMainMenu(ctx, name) {
    const { isAfterCutoff } = await Promise.resolve().then(() => __importStar(require('../utils/dates')));
    const afterCutoff = isAfterCutoff();
    const aviso = afterCutoff
        ? '\n⚠️ Son más de las 20:00 — los cambios grandes pueden requerir confirmación de Madapan.'
        : '';
    await ctx.reply(`Hola, ${name}!${aviso}\n\n¿Qué deseas hacer?`, telegraf_1.Markup.inlineKeyboard([
        [telegraf_1.Markup.button.callback('Ver pedido de mañana', 'view_tomorrow')],
        [telegraf_1.Markup.button.callback('Modificar pedido de mañana', 'change_tomorrow')],
        [telegraf_1.Markup.button.callback('Modificar otro día', 'select_day')],
        [telegraf_1.Markup.button.callback('Historial de pedidos', 'order_history')],
        [telegraf_1.Markup.button.callback('Contactar con Madapan', 'contact_madapan')],
    ]));
}
// Menú de bienvenida para usuarios SIN identificar: solo reserva de pizzas
// (pública) y la opción de identificarse como cliente de Madapan con su DNI.
async function sendWelcomeMenu(ctx) {
    ctx.session.step = 'idle';
    await ctx.reply('Hola! Soy el bot de Madapan 🥖\n\n¿Qué deseas hacer?', telegraf_1.Markup.inlineKeyboard([
        [telegraf_1.Markup.button.callback('🍕 Reservar pizza de fin de semana', 'start_pizza')],
        [telegraf_1.Markup.button.callback('🥖 Ya soy cliente de Madapan', 'identify_client')],
    ]));
}
// Inicia la identificación por DNI/CIF de un cliente de Madapan.
async function handleIdentifyClient(ctx) {
    ctx.session.step = 'awaiting_phone';
    await ctx.reply('Para acceder a tus pedidos, escribe tu NIF o CIF (por ejemplo: 12345678A o B12345678):', telegraf_1.Markup.removeKeyboard());
}
async function handleMainMenu(ctx) {
    const telegramId = String(ctx.from?.id ?? '');
    // Admin sin cliente cargado → menú de administrador
    if ((ctx.session.isAdmin || config_1.config.adminTelegramIds.includes(telegramId)) && !ctx.session.customer) {
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
async function sendAdminMenu(ctx) {
    const clienteActual = ctx.session.customer
        ? `\n\nCliente actual: ${ctx.session.customer.name}`
        : '';
    await ctx.reply(`Modo administrador 🔧${clienteActual}\n\n¿Qué deseas hacer?`, telegraf_1.Markup.inlineKeyboard([
        [telegraf_1.Markup.button.callback('Resumen de cambios', 'admin_resumen')],
        [telegraf_1.Markup.button.callback('Producción', 'admin_produccion')],
        [telegraf_1.Markup.button.callback('Editar pedido de un cliente', 'admin_select_client')],
        [telegraf_1.Markup.button.callback('Stock de pizzas', 'admin_pizzas_stock')],
        [telegraf_1.Markup.button.callback('Pedidos de pizzas', 'admin_pizzas_pedidos')],
        ...(ctx.session.customer
            ? [[telegraf_1.Markup.button.callback(`Seguir con ${ctx.session.customer.name}`, 'view_tomorrow')]]
            : []),
    ]));
}
async function handleAdminSelectClient(ctx) {
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
    const buttons = clientes.map(c => [telegraf_1.Markup.button.callback(c.name, `acli|${c.nif}`)]);
    buttons.push([telegraf_1.Markup.button.callback('Buscar por NIF', 'admin_by_nif')]);
    await ctx.reply('Selecciona el cliente cuyo pedido quieres editar:', telegraf_1.Markup.inlineKeyboard(buttons));
}
async function handleAdminByNif(ctx) {
    ctx.session.step = 'admin_awaiting_nif';
    ctx.session.customer = undefined;
    await ctx.reply('Escribe el NIF/CIF del cliente:');
}
async function handleAdminClientChosen(ctx, nif) {
    await adminLoadClient(ctx, nif);
}
async function handleAdminPizzaStockPrompt(ctx) {
    ctx.session.step = 'admin_awaiting_pizza_stock';
    await ctx.reply('¿Cuántas unidades de pizza hay disponibles este fin de semana? Escribe el número:');
}
async function handleAdminPizzaPedidos(ctx) {
    const { buildPizzaOrdersSummary } = await Promise.resolve().then(() => __importStar(require('../services/pizzaService')));
    await ctx.reply(buildPizzaOrdersSummary());
}
// Carga un cliente por NIF para que el admin opere sobre su pedido
async function adminLoadClient(ctx, nif) {
    const contact = await (await Promise.resolve().then(() => __importStar(require('../services/holdedClient')))).findContactByNif(nif);
    if (!contact) {
        await ctx.reply('No he encontrado ese NIF en Holded. Comprueba que es correcto e inténtalo de nuevo.');
        return;
    }
    const catalogClient = contact.code ? catalogService.getClientByNif(contact.code) : null;
    const customer = {
        telegramId: String(ctx.from?.id ?? ''),
        holdedContactId: contact.id,
        name: contact.name,
        phone: contact.phone ?? '',
        tarifa: catalogClient?.tarifa ?? 'Tarifa 2025',
        discount: catalogClient?.discount ?? 20,
    };
    ctx.session.customer = customer;
    ctx.session.step = 'idle';
    (0, logger_1.log)('CustomerFlows', `Admin ${ctx.from?.id} editando cliente ${customer.name}`);
    await ctx.reply(`✅ Cliente cargado: ${customer.name}`);
    await sendMainMenu(ctx, customer.name);
}
// ── View order ────────────────────────────────────────────────────────────────
async function handleViewOrder(ctx, dateStr) {
    const customer = await resolveCustomer(ctx);
    if (!customer)
        return;
    const date = dateStr ?? (0, dates_1.getTomorrowDate)();
    try {
        const order = await orderService.getOrderForDate(customer, date);
        if (!order) {
            await ctx.reply(`No hay pedido para ${(0, dates_1.formatDateSpanish)(date)}.`);
            return;
        }
        // Guardar líneas en sesión para acceso por índice
        ctx.session.orderLines = order.lines.map(l => ({ id: l.id, name: l.name, units: l.units }));
        ctx.session.selectedOrderId = order.id;
        ctx.session.selectedDate = date;
        let text = `Pedido para ${(0, dates_1.formatDateSpanish)(date)}:\n\n`;
        for (const line of order.lines) {
            text += `• ${line.name}: ${line.units} uds\n`;
        }
        await ctx.reply(text, telegraf_1.Markup.inlineKeyboard([
            [telegraf_1.Markup.button.callback('Modificar cantidades', `change_order|${date}`)],
            [telegraf_1.Markup.button.callback('Añadir producto', `add_product|${date}`)],
            [telegraf_1.Markup.button.callback('Menú principal', 'main_menu')],
        ]));
    }
    catch (err) {
        (0, logger_1.warn)('CustomerFlows', `handleViewOrder error: ${err.message}`);
        await ctx.reply('Error al obtener el pedido. Inténtalo de nuevo.');
    }
}
// ── Change order ──────────────────────────────────────────────────────────────
async function handleChangeOrder(ctx, dateStr) {
    const customer = await resolveCustomer(ctx);
    if (!customer)
        return;
    try {
        const order = await orderService.getOrderForDate(customer, dateStr);
        if (!order || order.lines.length === 0) {
            await ctx.reply(`No hay pedido para ${(0, dates_1.formatDateSpanish)(dateStr)}.`);
            return;
        }
        ctx.session.selectedOrderId = order.id;
        ctx.session.selectedDate = dateStr;
        ctx.session.orderLines = order.lines.map(l => ({ id: l.id, name: l.name, units: l.units }));
        // Usar índice en callback para mantener < 64 chars: "product|0", "product|1"...
        const buttons = order.lines.map((line, idx) => [
            telegraf_1.Markup.button.callback(`${line.name} (${line.units} uds)`, `product|${idx}`),
        ]);
        buttons.push([telegraf_1.Markup.button.callback('Cancelar', 'main_menu')]);
        await ctx.reply(`Pedido para ${(0, dates_1.formatDateSpanish)(dateStr)} - ¿Qué producto modificas?`, telegraf_1.Markup.inlineKeyboard(buttons));
    }
    catch (err) {
        (0, logger_1.warn)('CustomerFlows', `handleChangeOrder error: ${err.message}`);
        await ctx.reply('Error al cargar el pedido. Inténtalo de nuevo.');
    }
}
// ── Product selected ──────────────────────────────────────────────────────────
// lineIdx es el índice en ctx.session.orderLines
async function handleProductSelected(ctx, lineIdx) {
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
    await ctx.reply(`${sessionLine.name} — cantidad actual: ${sessionLine.units} uds\n\n¿Cuánto quieres cambiar?`, telegraf_1.Markup.inlineKeyboard([
        [
            telegraf_1.Markup.button.callback('-5', `d|${i}|-5`),
            telegraf_1.Markup.button.callback('-2', `d|${i}|-2`),
            telegraf_1.Markup.button.callback('-1', `d|${i}|-1`),
            telegraf_1.Markup.button.callback('+1', `d|${i}|1`),
            telegraf_1.Markup.button.callback('+2', `d|${i}|2`),
            telegraf_1.Markup.button.callback('+5', `d|${i}|5`),
        ],
        [telegraf_1.Markup.button.callback('Cantidad exacta', `exact|${i}`)],
        [telegraf_1.Markup.button.callback('Eliminar del pedido', `cancel_line|${i}`)],
        [telegraf_1.Markup.button.callback('Volver', 'main_menu')],
    ]));
}
// ── Quantity button ───────────────────────────────────────────────────────────
async function handleQuantityButton(ctx, lineIdx, delta) {
    const customer = await resolveCustomer(ctx);
    if (!customer)
        return;
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
        if (ctx.session.orderLines)
            ctx.session.orderLines[lineIdx].units = newUnits;
        await ctx.reply(result.message, telegraf_1.Markup.inlineKeyboard([
            [telegraf_1.Markup.button.callback('Seguir modificando', `change_order|${ctx.session.selectedDate}`)],
            [telegraf_1.Markup.button.callback('Ver pedido actualizado', 'view_tomorrow')],
            [telegraf_1.Markup.button.callback('Menú principal', 'main_menu')],
        ]));
    }
    catch (err) {
        (0, logger_1.warn)('CustomerFlows', `handleQuantityButton error: ${err.message}`);
        await ctx.reply('Error al aplicar el cambio. Inténtalo de nuevo.');
    }
}
// ── Exact quantity ────────────────────────────────────────────────────────────
async function handleExactQuantity(ctx, lineIdx) {
    ctx.session.step = 'entering_exact';
    ctx.session.selectedLineId = ctx.session.orderLines?.[lineIdx]?.id;
    await ctx.reply('Escribe la cantidad exacta (número entero):');
}
// ── Text handler ──────────────────────────────────────────────────────────────
async function handleText(ctx) {
    if (!ctx.message || !('text' in ctx.message))
        return;
    const text = ctx.message.text;
    try {
        // Admin: fijar stock de pizzas
        if (ctx.session.step === 'admin_awaiting_pizza_stock') {
            const n = parseInt(text.trim(), 10);
            if (isNaN(n) || n < 0) {
                await ctx.reply('Por favor escribe un número válido (0 o más):');
                return;
            }
            ctx.session.step = 'idle';
            const { setWeekendStock } = await Promise.resolve().then(() => __importStar(require('../services/pizzaService')));
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
                await ctx.reply('No he encontrado ese NIF en Madapan. Comprueba que es correcto o contacta con nosotros.');
                return;
            }
            ctx.session.customer = customer;
            ctx.session.step = 'idle';
            await ctx.reply(`Bienvenido, ${customer.name}! 👋\n\n` +
                `Desde aquí puedes:\n` +
                `• Ver tu pedido del día siguiente\n` +
                `• Cambiar cantidades de cualquier producto\n` +
                `• Añadir productos que no estén en el pedido\n\n` +
                `⚠️ Los cambios se admiten hasta las 20:00 del día anterior a la entrega.\n` +
                `Los panes especiales (centeno, semillas, integral, pasas y nueces) necesitan al menos 24h de antelación.\n\n` +
                `Para cualquier duda: 722 833 052 · hola@madapan.es (9:00–14:00)`);
            await sendMainMenu(ctx, customer.name);
            return;
        }
        // Usuario sin identificar (y fuera del flujo de pizza) → menú de bienvenida
        const telegramId = String(ctx.from?.id ?? '');
        const isAdminUser = ctx.session.isAdmin || config_1.config.adminTelegramIds.includes(telegramId);
        if (!ctx.session.customer && !clientCache.getClient(telegramId) && !isAdminUser) {
            await sendWelcomeMenu(ctx);
            return;
        }
        const customer = await resolveCustomer(ctx);
        if (!customer)
            return;
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
        if (ctx.session.step === 'entering_exact' &&
            ctx.session.selectedLineId &&
            ctx.session.selectedOrderId &&
            ctx.session.selectedDate) {
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
        const parsed = (0, messageParser_1.parseCustomerMessage)(text, new Date());
        if (parsed.status === 'unsupported') {
            await ctx.reply(`No puedo procesar ese tipo de solicitud. ${parsed.reason ?? ''}\n\nIndica el producto y la cantidad exacta.`);
            return;
        }
        if (parsed.status === 'ambiguous') {
            await ctx.reply(`No he podido entender tu solicitud.\n\n${parsed.reason ?? 'Por favor sé más específico con el producto, la cantidad y el día.'}`);
            return;
        }
        const dateStr = parsed.deliveryDate;
        const order = await orderService.getOrderForDate(customer, dateStr);
        if (!order) {
            await ctx.reply(`No hay pedido para ${(0, dates_1.formatDateSpanish)(dateStr)}.`);
            return;
        }
        const messages = [];
        for (const action of parsed.actions) {
            // Match by name alias
            const line = order.lines.find((l) => l.name.toLowerCase().includes(action.productAlias) ||
                action.productAlias.split(' ').some((word) => l.name.toLowerCase().includes(word)));
            if (!line) {
                messages.push(`Producto "${action.productAlias}" no encontrado en tu pedido.`);
                continue;
            }
            let newUnits;
            if (action.type === 'increment') {
                newUnits = line.units + action.quantity;
            }
            else if (action.type === 'decrement') {
                newUnits = Math.max(0, line.units - action.quantity);
            }
            else {
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
    }
    catch (err) {
        (0, logger_1.warn)('CustomerFlows', `handleText error: ${err.message}`);
        await ctx.reply('Ha ocurrido un error procesando tu mensaje. Inténtalo de nuevo.');
    }
}
// ── Day selection ─────────────────────────────────────────────────────────────
async function handleDaySelection(ctx) {
    const weekDates = (0, dates_1.getCurrentWeekDates)();
    const buttons = Object.entries(weekDates).map(([day, date]) => [
        telegraf_1.Markup.button.callback(`${day.charAt(0).toUpperCase() + day.slice(1)} (${date.slice(5).replace('-', '/')})`, `day|${date}`),
    ]);
    buttons.push([telegraf_1.Markup.button.callback('Cancelar', 'main_menu')]);
    await ctx.reply('¿Para qué día quieres modificar el pedido?', telegraf_1.Markup.inlineKeyboard(buttons));
}
// ── Contact Madapan ───────────────────────────────────────────────────────────
async function handleContactMadapan(ctx) {
    await ctx.reply('Contacto Madapan:\n\n• Teléfono: 722 833 052\n• Email: hola@madapan.es\n• Horario: de 9:00 a 14:00');
}
// ── Add product ───────────────────────────────────────────────────────────────
async function handleShowAddProduct(ctx, dateStr) {
    const customer = await resolveCustomer(ctx);
    if (!customer)
        return;
    const order = await orderService.getOrderForDate(customer, dateStr);
    if (!order) {
        await ctx.reply(`No hay pedido para ${(0, dates_1.formatDateSpanish)(dateStr)}.`);
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
    const buttons = [];
    for (let i = 0; i < disponibles.length; i += 2) {
        const row = [telegraf_1.Markup.button.callback(disponibles[i].name, `ap|${disponibles[i].cod}`)];
        if (disponibles[i + 1])
            row.push(telegraf_1.Markup.button.callback(disponibles[i + 1].name, `ap|${disponibles[i + 1].cod}`));
        buttons.push(row);
    }
    buttons.push([telegraf_1.Markup.button.callback('Cancelar', 'main_menu')]);
    await ctx.reply('¿Qué producto quieres añadir?', telegraf_1.Markup.inlineKeyboard(buttons));
}
async function handleAddProductSelected(ctx, productCod) {
    const customer = await resolveCustomer(ctx);
    if (!customer)
        return;
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
        const tomorrow = (0, dates_1.getTomorrowDate)();
        if (dateStr === tomorrow) {
            await ctx.reply(`⚠️ ${product.name} es un pan especial y necesita al menos 24 horas de antelación.\n\nNo se puede añadir para mañana. Si lo necesitas, contacta directamente con Madapan: 722 833 052.`, telegraf_1.Markup.inlineKeyboard([[telegraf_1.Markup.button.callback('Volver al menú', 'main_menu')]]));
            return;
        }
    }
    ctx.session.step = 'entering_exact';
    ctx.session.addingProduct = true;
    ctx.session.selectedLineId = productCod; // reutilizamos el campo para guardar el cod
    await ctx.reply(`${product.name}\n\n¿Cuántas unidades quieres añadir?`, telegraf_1.Markup.inlineKeyboard([
        [
            telegraf_1.Markup.button.callback('1', `apq|${productCod}|1`),
            telegraf_1.Markup.button.callback('2', `apq|${productCod}|2`),
            telegraf_1.Markup.button.callback('3', `apq|${productCod}|3`),
            telegraf_1.Markup.button.callback('5', `apq|${productCod}|5`),
            telegraf_1.Markup.button.callback('10', `apq|${productCod}|10`),
        ],
        [telegraf_1.Markup.button.callback('Otra cantidad', `apq_manual|${productCod}`)],
        [telegraf_1.Markup.button.callback('Cancelar', 'main_menu')],
    ]));
}
async function handleAddProductQuantity(ctx, productCod, units) {
    const customer = await resolveCustomer(ctx);
    if (!customer)
        return;
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
    await ctx.reply(result.message, telegraf_1.Markup.inlineKeyboard([
        [telegraf_1.Markup.button.callback('Añadir otro producto', `add_product|${dateStr}`)],
        [telegraf_1.Markup.button.callback('Ver pedido actualizado', 'view_tomorrow')],
        [telegraf_1.Markup.button.callback('Menú principal', 'main_menu')],
    ]));
}
// ── Cancel line ───────────────────────────────────────────────────────────────
async function handleCancelLineConfirm(ctx, lineIdx) {
    const sessionLine = ctx.session.orderLines?.[lineIdx];
    if (!sessionLine || !ctx.session.selectedOrderId || !ctx.session.selectedDate) {
        await ctx.reply('Sesión expirada. Usa /hola para empezar de nuevo.');
        return;
    }
    ctx.session.pendingCancelLineIdx = lineIdx;
    await ctx.reply(`¿Seguro que quieres eliminar "${sessionLine.name}" del pedido?`, telegraf_1.Markup.inlineKeyboard([
        [
            telegraf_1.Markup.button.callback('Sí, eliminar', `cancel_line_ok|${lineIdx}`),
            telegraf_1.Markup.button.callback('No, volver', `product|${lineIdx}`),
        ],
    ]));
}
async function handleCancelLine(ctx, lineIdx) {
    const customer = await resolveCustomer(ctx);
    if (!customer)
        return;
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
        const { removeLineFromOrder } = await Promise.resolve().then(() => __importStar(require('../services/holdedClient')));
        const result = await removeLineFromOrder(orderId, sessionLine.id, order);
        if (!result.success) {
            await ctx.reply('Error al eliminar el producto. Inténtalo de nuevo.');
            return;
        }
        // Eliminar de la sesión
        if (ctx.session.orderLines) {
            ctx.session.orderLines.splice(lineIdx, 1);
        }
        const { logChange } = await Promise.resolve().then(() => __importStar(require('../utils/logger')));
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
            dryRun: (await Promise.resolve().then(() => __importStar(require('../config')))).config.dryRun,
        });
        await ctx.reply(`✓ "${sessionLine.name}" eliminado del pedido.`, telegraf_1.Markup.inlineKeyboard([
            [telegraf_1.Markup.button.callback('Ver pedido actualizado', `view_order|${dateStr}`)],
            [telegraf_1.Markup.button.callback('Menú principal', 'main_menu')],
        ]));
    }
    catch (err) {
        (0, logger_1.warn)('CustomerFlows', `handleCancelLine error: ${err.message}`);
        await ctx.reply('Error al eliminar el producto. Inténtalo de nuevo.');
    }
}
// ── Order history ─────────────────────────────────────────────────────────────
async function handleOrderHistory(ctx) {
    const customer = await resolveCustomer(ctx);
    if (!customer)
        return;
    try {
        const { listOrdersByContact } = await Promise.resolve().then(() => __importStar(require('../services/holdedClient')));
        const { formatDateSpanish } = await Promise.resolve().then(() => __importStar(require('../utils/dates')));
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
                ? new Date(o.date * 1000).toISOString().split('T')[0]
                : String(o.date).split('T')[0];
            const label = formatDateSpanish(dateStr);
            const nLines = Array.isArray(o.lines) ? o.lines.length : '?';
            text += `• ${label} — ${nLines} producto(s)\n`;
        }
        await ctx.reply(text, telegraf_1.Markup.inlineKeyboard([
            [telegraf_1.Markup.button.callback('Menú principal', 'main_menu')],
        ]));
    }
    catch (err) {
        (0, logger_1.warn)('CustomerFlows', `handleOrderHistory error: ${err.message}`);
        await ctx.reply('Error al obtener el historial. Inténtalo de nuevo.');
    }
}
// ── Helper ────────────────────────────────────────────────────────────────────
async function resolveCustomer(ctx) {
    const telegramId = String(ctx.from?.id ?? '');
    if (ctx.session.customer)
        return ctx.session.customer;
    const cached = clientCache.getClient(telegramId);
    if (cached) {
        ctx.session.customer = cached;
        return cached;
    }
    if (ctx.session.isAdmin || config_1.config.adminTelegramIds.includes(telegramId)) {
        ctx.session.isAdmin = true;
        await sendAdminMenu(ctx);
        return null;
    }
    // Usuario sin identificar → menú de bienvenida (pizza / identificarse)
    await sendWelcomeMenu(ctx);
    return null;
}
//# sourceMappingURL=customerFlows.js.map