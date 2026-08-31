import { Markup } from 'telegraf';
import { Message } from 'telegraf/types';
import { BotContext } from './customerFlows';
import * as penas from '../services/penasService';
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
    productos: ['Barra', 'Barra grande', 'Pan de cuadros', 'Chapata', 'Hogaza',
      'Pan de canteros', 'Pan pasas y nueces'],
  },
  {
    nombre: '🥟 Empanadas',
    productos: ['Empanada de atún y pisto', 'Empanada de bonito',
      'Empanada de bacon, queso y pimientos', 'Empanada de cecina'],
  },
  { nombre: '🍖 Asados', productos: ['Asado'] },
  { nombre: '🍕 Pizzas', productos: ['Pizza'] },
];

export interface PenaSessionData {
  pena?: string;
  telefono?: string;
  dias: penas.PedidoDia[];
  fecha?: string;          // día que se está rellenando
  producto?: string;
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
  t += '\n🎁 Si hacéis pedido para *los cinco días*, os regalamos una ';
  t += '*Super chapata* y una *Super cookie* el día 30.\n\n';
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

  let t = puestos
    ? `Llevas ${puestos} de ${penas.DIAS_FIESTAS.length} días.\n\n¿Añadimos otro?`
    : '¿Para qué día queréis pedir?';
  if (puestos && puestos < penas.DIAS_FIESTAS.length) {
    t += `\n\n🎁 Si pedís los ${penas.DIAS_FIESTAS.length} días, entra el regalo.`;
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

  await ctx.reply(
    `✅ ${cantidad} × ${puesto} para el ${etiqueta(s.fecha)}`,
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

  const completo = penas.esCompleto(s.dias);
  let t = `🎪 ${s.pena}\n📞 ${s.telefono}\n\n`;
  for (const d of [...s.dias].sort((a, b) => a.fecha.localeCompare(b.fecha))) {
    if (!d.lineas.length) continue;
    t += `${etiqueta(d.fecha)}\n`;
    for (const l of d.lineas) t += `   ${l.cantidad} × ${l.producto}\n`;
  }
  t += completo
    ? '\n🎁 ¡Pedido completo! Llevaréis Super chapata y Super cookie el día 30.'
    : `\n(Con los ${penas.DIAS_FIESTAS.length} días entraría el regalo.)`;
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

  const pedido = penas.crear({
    pena: s.pena,
    telefono: s.telefono,
    telegramId: String(ctx.from?.id ?? ''),
    dias: s.dias.filter(d => d.lineas.length),
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
