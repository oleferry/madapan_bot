import { Markup } from 'telegraf';
import { Message } from 'telegraf/types';
import { BotContext } from './customerFlows';
import * as sobras from '../services/sobrasService';
import * as historico from '../services/historicoVentas';
import { productosDelDia } from '../services/productionSummary';
import { formatDateSpanish, getTodayDate } from '../utils/dates';
import { config } from '../config';
import { log } from '../utils/logger';

// Anotar lo que sobra en la tienda de Madapan. Sustituye al recuento por
// WhatsApp.
//
// Solo la tienda: en los puntos de reparto la devolución ya se mete en el
// albarán, así que lo entregado en Holded viene neto y anotarlo aparte
// contaría dos veces lo mismo.
//
// La lista sale de la PRODUCCIÓN del día, no del albarán de la tienda: es lo
// que de verdad se ha horneado, y el pan del mostrador no lleva albarán hasta
// que se vende. Al final siempre se ofrece añadir algo suelto a mano.

// Nombre del punto propio tal y como está en Holded.
const TIENDA = process.env['PUNTO_PROPIO'] ?? 'Madapan';

export interface SobraSessionData {
  fecha?: string;
  cliente?: string;
  produccion?: Array<{ producto: string; sku: string; units: number }>;
  lineas: sobras.SobraLinea[];
  idx?: number;                  // producto por el que va
}

function esStaff(ctx: BotContext): boolean {
  return config.adminTelegramIds.includes(String(ctx.from?.id ?? ''));
}

// Las sobras se cuentan y se comunican el mismo día, así que no se pregunta la
// fecha: se entra directo a lo de hoy. Admite una fecha suelta
// (/sobras 2026-08-20) por si algún día hay que corregir a posteriori.
export async function handleSobrasStart(ctx: BotContext, fecha?: string): Promise<void> {
  if (!esStaff(ctx)) return;
  ctx.session.sobra = { lineas: [] };
  ctx.session.step = 'idle';
  await handleSobrasDia(ctx, fecha ?? getTodayDate());
}

export async function handleSobrasDia(ctx: BotContext, fecha: string): Promise<void> {
  if (!esStaff(ctx)) return;
  const s = (ctx.session.sobra ??= { lineas: [] });
  s.fecha = fecha;
  s.cliente = TIENDA;

  // Solo la producción de la TIENDA: lo de los puntos de reparto ya va en su
  // albarán, y mezclarlo obligaba a pasar por productos que aquí no se venden.
  let lista = (await productosDelDia(fecha, TIENDA)).map(p => ({
    producto: p.producto, sku: p.sku ?? '', units: p.units,
  }));

  // Sin producción registrada, se cae al albarán de la tienda: al menos da los
  // productos habituales para no obligar a escribirlo todo.
  if (!lista.length) {
    const entregas = await historico.cargar();
    const suya = entregas.find(e => e.cliente === TIENDA && e.fecha === fecha);
    lista = (suya?.lineas ?? []).map(l => ({ producto: l.name, sku: l.sku, units: l.units }));
  }
  s.produccion = lista;

  if (!lista.length) {
    await ctx.reply(
      `No tengo producción registrada del ${formatDateSpanish(fecha)}, ` +
      'pero puedes anotar productos sueltos.',
      Markup.inlineKeyboard([[Markup.button.callback('➕ Anotar un producto', 'sb_otro_prod')]])
    );
    return;
  }

  await ctx.reply(
    `🥖 Sobras de ${TIENDA} — ${formatDateSpanish(fecha)}\n` +
    `${lista.length} producto(s) en producción. Ve marcando lo que ha sobrado.`
  );
  s.idx = 0;
  await preguntarProducto(ctx);
}

async function preguntarProducto(ctx: BotContext): Promise<void> {
  const s = ctx.session.sobra;
  if (!s?.produccion || s.idx === undefined) return;

  if (s.idx >= s.produccion.length) {
    // Siempre se ofrece añadir algo que no estaba: hay días con producto
    // suelto que no aparece en ningún pedido.
    await ctx.reply(
      'Eso es todo lo de la lista. ¿Ha sobrado algo más que no salga arriba?',
      Markup.inlineKeyboard([
        [Markup.button.callback('➕ Añadir otro producto', 'sb_otro_prod')],
        [Markup.button.callback('✅ Terminar', 'sb_guardar')],
      ])
    );
    return;
  }

  const p = s.produccion[s.idx]!;
  const opciones = [0, 1, 2, 3, 4, 5].filter(n => n <= p.units);
  const filas: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let i = 0; i < opciones.length; i += 3) {
    filas.push(opciones.slice(i, i + 3).map(n => Markup.button.callback(String(n), `sb_cant|${n}`)));
  }
  filas.push([Markup.button.callback('Otra cantidad', 'sb_manual')]);
  filas.push([Markup.button.callback('⏭️ Del resto no sobró nada', 'sb_fin')]);

  await ctx.reply(
    `${p.producto} — producidos ${p.units}\n¿Cuántos han sobrado?`,
    Markup.inlineKeyboard(filas)
  );
}

export async function handleSobrasCantidad(ctx: BotContext, n: number): Promise<void> {
  if (!esStaff(ctx)) return;
  const s = ctx.session.sobra;
  if (!s?.produccion || s.idx === undefined) return;
  const p = s.produccion[s.idx]!;
  if (n > 0) s.lineas.push({ producto: p.producto, ...(p.sku ? { sku: p.sku } : {}), cantidad: n });
  s.idx += 1;
  await preguntarProducto(ctx);
}

export async function handleSobrasManual(ctx: BotContext): Promise<void> {
  if (!esStaff(ctx)) return;
  ctx.session.step = 'sb_awaiting_cantidad';
  await ctx.reply('Escribe cuántos han sobrado.');
}

export async function handleSobrasFin(ctx: BotContext): Promise<void> {
  if (!esStaff(ctx)) return;
  const s = ctx.session.sobra;
  if (!s) return;
  s.idx = (s.produccion ?? []).length;   // el resto queda a cero
  await preguntarProducto(ctx);          // remata ofreciendo el producto libre
}

// ── Producto que no estaba en la lista ────────────────────────────────────────

export async function handleOtroProducto(ctx: BotContext): Promise<void> {
  if (!esStaff(ctx)) return;
  ctx.session.sobra ??= { lineas: [] };
  ctx.session.step = 'sb_awaiting_producto';
  await ctx.reply(
    '¿Qué ha sobrado? Escríbelo con la cantidad delante.\nPor ejemplo: 3 empanada de bonito'
  );
}

export async function handleGuardar(ctx: BotContext): Promise<void> {
  if (!esStaff(ctx)) return;
  await confirmar(ctx);
}

async function confirmar(ctx: BotContext): Promise<void> {
  const s = ctx.session.sobra;
  if (!s?.fecha || !s.cliente) return;
  ctx.session.step = 'idle';

  const previa = sobras.sobrasDe(s.cliente, s.fecha);
  sobras.registrar({
    fecha: s.fecha, cliente: s.cliente, lineas: s.lineas,
    registradoPor: String(ctx.from?.id ?? ''),
  });

  let txt = s.lineas.length
    ? `✅ Sobras anotadas — ${formatDateSpanish(s.fecha)}\n\n` +
      s.lineas.map(l => `  ${l.cantidad} × ${l.producto}`).join('\n')
    : `✅ Anotado: no sobró nada el ${formatDateSpanish(s.fecha)}.`;
  if (previa) txt += '\n\n(Sustituye al recuento anterior de ese día.)';

  const fecha = s.fecha;
  delete ctx.session.sobra;
  log('SobraFlow', `Sobras de ${TIENDA} ${fecha} por ${ctx.from?.id}`);
  await ctx.reply(txt, Markup.inlineKeyboard([
    [Markup.button.callback('📊 Ver producción sugerida', `sb_aj|0|${new Date().getDay()}`)],
  ]));
}

// ── Ajuste ────────────────────────────────────────────────────────────────────

export async function handleAjuste(ctx: BotContext, consulta: string, dow: number): Promise<void> {
  if (!esStaff(ctx)) return;
  const entregas = await historico.cargar();

  // Sin nombre, la tienda: es el único punto con recuento de sobras y por
  // tanto el único donde el ajuste tiene dos cosas que cruzar. Se admite un
  // nombre por si se quiere ver la media entregada de un punto de reparto.
  const q = (consulta.trim() || TIENDA).toLowerCase();
  const encontrados = historico.clientes(entregas).filter(c => c.cliente.toLowerCase().includes(q));
  if (!encontrados.length) {
    await ctx.reply(`No encuentro ningún punto que se parezca a "${consulta}".`);
    return;
  }
  const cliente = encontrados[0]!.cliente;
  await ctx.reply(sobras.textoSugerencia(cliente, dow, sobras.sugerirParaDia(entregas, cliente, dow)));
}

export async function handleAjusteBoton(ctx: BotContext, _idx: number, dow: number): Promise<void> {
  if (!esStaff(ctx)) return;
  const entregas = await historico.cargar();
  await ctx.reply(sobras.textoSugerencia(TIENDA, dow, sobras.sugerirParaDia(entregas, TIENDA, dow)));
}

// ── Texto libre ───────────────────────────────────────────────────────────────

export async function handleSobraText(ctx: BotContext): Promise<boolean> {
  const paso = ctx.session.step;
  if (paso !== 'sb_awaiting_cantidad' && paso !== 'sb_awaiting_producto') return false;
  if (!ctx.message || !('text' in ctx.message)) return false;
  if (!esStaff(ctx)) return false;

  const texto = (ctx.message as Message.TextMessage).text.trim();

  if (paso === 'sb_awaiting_producto') {
    // "3 empanada de bonito" → 3 + el nombre. Sin número delante, 1.
    const m = /^(\d+(?:[.,]\d+)?)\s+(.+)$/.exec(texto);
    const cantidad = m ? parseFloat(m[1]!.replace(',', '.')) : 1;
    const producto = (m ? m[2]! : texto).trim();
    if (!producto) {
      await ctx.reply('No he entendido el producto. Escribe por ejemplo: 3 empanada de bonito');
      return true;
    }
    const s = (ctx.session.sobra ??= { lineas: [] });
    s.lineas.push({ producto, cantidad });
    ctx.session.step = 'idle';
    await ctx.reply(
      `Anotado: ${cantidad} × ${producto}`,
      Markup.inlineKeyboard([
        [Markup.button.callback('➕ Añadir otro', 'sb_otro_prod')],
        [Markup.button.callback('✅ Terminar', 'sb_guardar')],
      ])
    );
    return true;
  }

  const n = parseInt(texto, 10);
  if (isNaN(n) || n < 0) {
    await ctx.reply('Escribe un número (0 o más).');
    return true;
  }
  ctx.session.step = 'idle';
  await handleSobrasCantidad(ctx, n);
  return true;
}

// ── Revisar lo anotado ────────────────────────────────────────────────────────

// Sin esto no había forma de saber si alguien anotó las sobras de un día: el
// fichero vive en el volumen de Railway y los logs se pierden al desplegar.
export async function handleVerSobras(ctx: BotContext, dias = 14): Promise<void> {
  if (!esStaff(ctx)) return;
  const todas = sobras.todas().sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, dias);
  if (!todas.length) {
    await ctx.reply('Todavía no se ha anotado ninguna sobra. Se hace con /sobras.');
    return;
  }

  let txt = `🥖 Últimos ${todas.length} recuento(s) de sobras\n\n`;
  for (const s of todas) {
    txt += `— ${formatDateSpanish(s.fecha)} —\n`;
    if (!s.lineas.length) {
      txt += '   no sobró nada\n';
    } else {
      for (const l of s.lineas) txt += `   ${l.cantidad} × ${l.producto}\n`;
    }
  }

  // Los días de los que NO hay recuento son la información que de verdad
  // falta: sin ellos el ajuste no tiene con qué comparar.
  const anotados = new Set(sobras.todas().map(s => s.fecha));
  const huecos: string[] = [];
  const hoy = new Date(`${getTodayDate()}T12:00:00Z`);
  for (let i = 1; i <= 7; i++) {
    const d = new Date(hoy);
    d.setUTCDate(d.getUTCDate() - i);
    const f = d.toISOString().slice(0, 10);
    if (!anotados.has(f)) huecos.push(formatDateSpanish(f));
  }
  if (huecos.length) {
    txt += `\n⚠️ Sin anotar en los últimos 7 días: ${huecos.join(', ')}`;
  }

  await ctx.reply(txt);
}
