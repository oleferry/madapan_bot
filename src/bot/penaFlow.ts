import { Markup } from 'telegraf';
import { Message } from 'telegraf/types';
import { BotContext } from './customerFlows';
import * as penas from '../services/penasService';
import * as precios from '../services/preciosService';
import { sendToAllStaff } from '../services/notifier';
import { config } from '../config';
import { log, warn } from '../utils/logger';

// Pedidos de peñas para las fiestas.
//
// Este flujo es PÚBLICO: el enlace se comparte por redes y entra directo aquí
// (t.me/<bot>?start=penas). Lo rellena la propia peña, así que todo va con
// botones y solo se escriben tres cosas: el nombre, el teléfono y las
// cantidades que no estén entre las de un toque.

const CATEGORIAS: Array<{ nombre: string; productos: string[] }> = [
  {
    nombre: '🥖 Pan',
    // Sin "Barra grande": en Holded la grande es la Barra normal, y sin
    // producto no hay precio con el que sumar el total.
    productos: ['Barra', 'Pan de cuadros', 'Chapata', 'Hogaza',
      'Pan de canteros', 'Pan pasas y nueces'],
  },
  {
    nombre: '🥟 Empanadas',
    productos: ['Empanada de atún y pisto', 'Empanada de bonito',
      'Empanada de bacon, queso y pimientos', 'Empanada de cecina'],
  },
  { nombre: '🍖 Asados', productos: ['Asado'] },
  { nombre: '🍕 Pizzas', productos: ['Pizza'] },
  { nombre: '🍪 Dulces', productos: ['Super cookie', 'Caja de 4 cookies', 'Rosquillas 500gr'] },
  {
    nombre: '🎂 Tartas',
    productos: ['Tarta (genérica)', 'Tarta de limón', 'Tarta de queso con frutos rojos',
      'Tarta de San Marcos con chocolate', 'Tarta de hojaldre y crema', 'Tarta Pavlova'],
  },
];

export interface PenaSessionData {
  pena?: string;
  telefono?: string;
  dias: penas.PedidoDia[];
  fecha?: string;          // día que se está rellenando
  producto?: string;
}

// Total del pedido tal y como va, para poder decirle a la peña cuánto lleva y
// cuánto le falta para el siguiente regalo.
async function totalDe(s: PenaSessionData): Promise<{ total: number; sinPrecio: string[] }> {
  try {
    return penas.calcularTotal(s.dias, await precios.precios());
  } catch (err) {
    warn('PenaFlow', `No se pudieron leer los precios: ${(err as Error).message}`);
    return { total: 0, sinPrecio: [] };
  }
}

// Línea de "llevas X €, te faltan Y para el regalo".
function textoTotal(total: number, sinPrecio: string[]): string {
  if (!total && !sinPrecio.length) return '';
  let t = `
💶 Lleváis ${total.toFixed(2)} €`;
  const siguiente = penas.siguienteUmbral(total);
  if (siguiente) {
    const falta = siguiente.desde - total;
    // "Os faltan 0,01 €" es cierto pero queda ridículo: cuando caen justo en
    // el umbral se dice de otra forma.
    t += falta < 1
      ? `
🎁 ¡Casi! Con una pieza más entra ${siguiente.regalos.join(' + ')}`
      : `
🎁 Os faltan ${falta.toFixed(2)} € para ${siguiente.regalos.join(' + ')}`;
  } else {
    t += `
🎁 Ya tenéis ${penas.regalosPara(total).join(' + ')}`;
  }
  if (sinPrecio.length) t += `
(${sinPrecio.join(', ')}: se cobra al peso, no entra en la cuenta)`;
  return t;
}

// Mismo criterio que en las pizzas: sin teléfono no hay forma de avisar de
// nada, y aquí menos, que son pedidos grandes para un día concreto.
function esTelefonoValido(v: string): boolean {
  const limpio = v.replace(/[\s.\-()]/g, '');
  return /^(\+34|0034|34)?[6-9]\d{8}$/.test(limpio);
}

function etiqueta(fecha: string): string {
  return penas.DIAS_FIESTAS.find(f => f.fecha === fecha)?.etiqueta ?? fecha;
}

// ── Entrada ───────────────────────────────────────────────────────────────────

export async function handlePenaStart(ctx: BotContext): Promise<void> {
  ctx.session.pena = { dias: [] };
  ctx.session.step = 'pena_awaiting_nombre';

  let t = '🎪 *Pedidos de peñas — Fiestas*\n\n';
  t += 'Preparamos vuestro pan, empanadas, asados y pizzas para los días de fiestas:\n';
  for (const d of penas.DIAS_FIESTAS) t += `  · ${d.etiqueta}\n`;
  t += '\n🎁 *Regalos por vuestro pedido de fiestas*\n';
  t += '  · Más de 60 € → *Super chapata*\n';
  t += '  · Más de 120 € → *Super chapata* y *Brazo gitano*\n';
  t += 'Se entregan el día 30. Os iré diciendo cuánto lleváis y cuánto os falta.\n\n';
  t += '¿Cómo se llama vuestra peña?';

  await ctx.reply(t, { parse_mode: 'Markdown' });
}

// ── Días ──────────────────────────────────────────────────────────────────────

async function pedirDia(ctx: BotContext): Promise<void> {
  const s = ctx.session.pena;
  if (!s) return;
  ctx.session.step = 'idle';

  const botones = penas.DIAS_FIESTAS.map(d => {
    const hecho = s.dias.find(x => x.fecha === d.fecha);
    const n = hecho?.lineas.reduce((t, l) => t + l.cantidad, 0) ?? 0;
    return [Markup.button.callback(
      `${n ? '✅' : '▫️'} ${d.etiqueta}${n ? ` (${n})` : ''}`, `pn_dia|${d.fecha}`
    )];
  });

  const puestos = s.dias.filter(d => d.lineas.length).length;
  if (puestos) botones.push([Markup.button.callback('✅ Terminar el pedido', 'pn_fin')]);

  let t = puestos ? '¿Añadimos otro día?' : '¿Para qué día queréis pedir?';
  if (puestos) {
    const { total, sinPrecio } = await totalDe(s);
    t += '\n' + textoTotal(total, sinPrecio);
  }
  await ctx.reply(t, Markup.inlineKeyboard(botones));
}

export async function handlePenaDia(ctx: BotContext, fecha: string): Promise<void> {
  const s = ctx.session.pena;
  if (!s) { await handlePenaStart(ctx); return; }
  s.fecha = fecha;
  await pedirCategoria(ctx);
}

// ── Productos ─────────────────────────────────────────────────────────────────

async function pedirCategoria(ctx: BotContext): Promise<void> {
  const s = ctx.session.pena;
  if (!s?.fecha) return;
  ctx.session.step = 'idle';

  const dia = s.dias.find(d => d.fecha === s.fecha);
  const yaPuesto = dia?.lineas.length
    ? '\n\nYa lleváis:\n' + dia.lineas.map(l => `   ${l.cantidad} × ${l.producto}`).join('\n')
    : '';

  const botones = CATEGORIAS.map((c, i) => [Markup.button.callback(c.nombre, `pn_cat|${i}`)]);
  if (dia?.lineas.length) botones.push([Markup.button.callback('⬅️ Volver a los días', 'pn_dias')]);

  await ctx.reply(`${etiqueta(s.fecha)}${yaPuesto}\n\n¿Qué queréis?`, Markup.inlineKeyboard(botones));
}

export async function handlePenaCategorias(ctx: BotContext): Promise<void> {
  await pedirCategoria(ctx);
}

export async function handlePenaDias(ctx: BotContext): Promise<void> {
  await pedirDia(ctx);
}

export async function handlePenaCategoria(ctx: BotContext, idx: number): Promise<void> {
  const cat = CATEGORIAS[idx];
  if (!cat) return;
  const botones = cat.productos.map((p, i) => [Markup.button.callback(p, `pn_prod|${idx}|${i}`)]);
  botones.push([Markup.button.callback('⬅️ Otra cosa', 'pn_cats')]);
  await ctx.reply(cat.nombre, Markup.inlineKeyboard(botones));
}

export async function handlePenaProducto(ctx: BotContext, cat: number, prod: number): Promise<void> {
  const s = ctx.session.pena;
  const producto = CATEGORIAS[cat]?.productos[prod];
  if (!s || !producto) return;
  s.producto = producto;

  const fila = (ns: number[]): ReturnType<typeof Markup.button.callback>[] =>
    ns.map(n => Markup.button.callback(String(n), `pn_cant|${n}`));
  await ctx.reply(
    `${producto}\n¿Cuántos?`,
    Markup.inlineKeyboard([
      fila([1, 2, 3, 4]),
      fila([5, 6, 8, 10]),
      fila([12, 15, 20, 25]),
      [Markup.button.callback('Otra cantidad', 'pn_manual')],
    ])
  );
}

export async function handlePenaCantidad(ctx: BotContext, cantidad: number): Promise<void> {
  const s = ctx.session.pena;
  if (!s?.fecha || !s.producto) return;

  let dia = s.dias.find(d => d.fecha === s.fecha);
  if (!dia) { dia = { fecha: s.fecha, lineas: [] }; s.dias.push(dia); }

  // Repetir un producto suma, no duplica la línea.
  const linea = dia.lineas.find(l => l.producto === s.producto);
  if (linea) linea.cantidad += cantidad;
  else dia.lineas.push({ producto: s.producto, cantidad });

  const puesto = s.producto;
  delete s.producto;
  ctx.session.step = 'idle';

  const { total, sinPrecio } = await totalDe(s);
  await ctx.reply(
    `✅ ${cantidad} × ${puesto} para el ${etiqueta(s.fecha)}` + textoTotal(total, sinPrecio),
    Markup.inlineKeyboard([
      [Markup.button.callback('➕ Añadir más de este día', 'pn_cats')],
      [Markup.button.callback('📅 Otro día', 'pn_dias')],
      [Markup.button.callback('✅ Terminar el pedido', 'pn_fin')],
    ])
  );
}

export async function handlePenaCantidadManual(ctx: BotContext): Promise<void> {
  ctx.session.step = 'pena_awaiting_cantidad';
  await ctx.reply('Escribid la cantidad.');
}

// ── Cierre ────────────────────────────────────────────────────────────────────

export async function handlePenaFin(ctx: BotContext): Promise<void> {
  const s = ctx.session.pena;
  if (!s?.dias.some(d => d.lineas.length)) {
    await ctx.reply('Todavía no habéis pedido nada.');
    await pedirDia(ctx);
    return;
  }
  ctx.session.step = 'idle';

  const { total, sinPrecio } = await totalDe(s);
  let t = `🎪 ${s.pena}\n📞 ${s.telefono}\n\n`;
  for (const d of [...s.dias].sort((a, b) => a.fecha.localeCompare(b.fecha))) {
    if (!d.lineas.length) continue;
    t += `${etiqueta(d.fecha)}\n`;
    for (const l of d.lineas) t += `   ${l.cantidad} × ${l.producto}\n`;
  }
  t += textoTotal(total, sinPrecio);
  t += '\n\n¿Lo confirmamos?';

  await ctx.reply(t, Markup.inlineKeyboard([
    [Markup.button.callback('✅ Confirmar pedido', 'pn_ok')],
    [Markup.button.callback('📅 Seguir añadiendo', 'pn_dias')],
  ]));
}

export async function handlePenaConfirmar(ctx: BotContext): Promise<void> {
  const s = ctx.session.pena;
  if (!s?.pena || !s.telefono || !s.dias.some(d => d.lineas.length)) {
    await ctx.reply('Se ha perdido el pedido. Empezad de nuevo con /penas.');
    return;
  }

  // Los precios se leen aquí y no antes: entre que empieza el pedido y lo
  // confirma pueden pasar minutos, y lo que vale es el precio al cerrarlo.
  let tabla = new Map<string, number>();
  try {
    tabla = await precios.precios();
  } catch (err) {
    warn('PenaFlow', `Sin precios al confirmar: ${(err as Error).message}`);
  }

  const pedido = penas.crear({
    pena: s.pena,
    telefono: s.telefono,
    telegramId: String(ctx.from?.id ?? ''),
    dias: s.dias.filter(d => d.lineas.length),
    precios: tabla,
  });

  delete ctx.session.pena;
  ctx.session.step = 'idle';
  log('PenaFlow', `${pedido.numero} de ${pedido.pena}`);

  let t = `✅ ¡Pedido confirmado!\n\nNúmero: ${pedido.numero}\n\n`;
  t += penas.textoPedido(pedido).split('\n').slice(2).join('\n');
  t += '\n\nOs esperamos en Madapan. Si necesitáis cambiar algo, llamad al 722 833 052.';
  await ctx.reply(t);

  sendToAllStaff(`🎪 NUEVO PEDIDO DE PEÑA\n\n${penas.textoPedido(pedido)}`)
    .catch(err => warn('PenaFlow', `Error avisando al staff: ${(err as Error).message}`));
}

// ── Consulta para el staff ────────────────────────────────────────────────────

export async function handlePenasResumen(ctx: BotContext): Promise<void> {
  if (!config.adminTelegramIds.includes(String(ctx.from?.id ?? ''))) return;
  const t = penas.resumen();
  for (let i = 0; i < t.length; i += 3900) await ctx.reply(t.slice(i, i + 3900));
}

// ── Texto libre ───────────────────────────────────────────────────────────────

export async function handlePenaText(ctx: BotContext): Promise<boolean> {
  const paso = ctx.session.step;
  if (!paso?.startsWith('pena_')) return false;
  if (!ctx.message || !('text' in ctx.message)) return false;

  const texto = (ctx.message as Message.TextMessage).text.trim();
  const s = (ctx.session.pena ??= { dias: [] });

  if (paso === 'pena_awaiting_nombre') {
    if (texto.length < 2) {
      await ctx.reply('Escribid el nombre de la peña.');
      return true;
    }
    s.pena = texto;
    ctx.session.step = 'pena_awaiting_telefono';
    await ctx.reply(`Encantados, ${texto} 🎉\n\n¿Un teléfono de contacto?`);
    return true;
  }

  if (paso === 'pena_awaiting_telefono') {
    if (!esTelefonoValido(texto)) {
      await ctx.reply('Ese teléfono no parece válido. Escribid un móvil de 9 dígitos.');
      return true;
    }
    s.telefono = texto;
    await pedirDia(ctx);
    return true;
  }

  if (paso === 'pena_awaiting_cantidad') {
    const n = parseInt(texto, 10);
    if (isNaN(n) || n <= 0) {
      await ctx.reply('Escribid un número mayor que 0.');
      return true;
    }
    await handlePenaCantidad(ctx, n);
    return true;
  }

  return false;
}
