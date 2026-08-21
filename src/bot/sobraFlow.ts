import { Markup } from 'telegraf';
import { Message } from 'telegraf/types';
import { BotContext } from './customerFlows';
import * as sobras from '../services/sobrasService';
import * as historico from '../services/historicoVentas';
import { formatDateSpanish, getTodayDate } from '../utils/dates';
import { config } from '../config';
import { log } from '../utils/logger';

// Anotar lo que sobra en la tienda de Madapan. Sustituye al recuento por
// WhatsApp.
//
// Solo la tienda: en los puntos de reparto la devolución ya se mete en el
// albarán, así que lo entregado en Holded ya viene neto y no hay nada que
// anotar aparte. Contarlo dos veces daría un ajuste falso.
//
// La clave para que se use de verdad: no hacer escribir. El bot ya sabe lo que
// salió ese día (está en el albarán de Madapan), así que enseña esos productos
// uno a uno y solo hay que tocar la cantidad. Lo que no se toca, se da por
// vendido.

// Nombre del punto propio tal y como está en Holded.
const TIENDA = process.env['PUNTO_PROPIO'] ?? 'Madapan';

export interface SobraSessionData {
  fecha?: string;
  cliente?: string;
  entregado?: Array<{ producto: string; sku: string; units: number }>;
  lineas: sobras.SobraLinea[];
  idx?: number;                  // producto por el que va
}

function esStaff(ctx: BotContext): boolean {
  return config.adminTelegramIds.includes(String(ctx.from?.id ?? ''));
}

// Las sobras se cuentan y se comunican el mismo día, así que no se pregunta la
// fecha: se entra directo a lo de hoy. El comando admite una fecha suelta
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

  const entregas = await historico.cargar();
  const suya = entregas.find(e => e.cliente === TIENDA && e.fecha === fecha);
  s.entregado = (suya?.lineas ?? []).map(l => ({ producto: l.name, sku: l.sku, units: l.units }));

  if (s.entregado.length) {
    await ctx.reply(
      `🥖 Sobras de ${TIENDA} — ${formatDateSpanish(fecha)}
` +
      `${s.entregado.length} productos. Ve marcando lo que ha sobrado.`
    );
  }

  if (!s.entregado.length) {
    await ctx.reply(
      `No tengo lo que salió a ${TIENDA} el ${formatDateSpanish(fecha)}. ` +
      'Si el albarán es de hoy, puede que aún no esté descargado: prueba /historico_refrescar.'
    );
    return;
  }
  await ctx.reply(
    `🥖 Sobras de ${TIENDA} — ${formatDateSpanish(fecha)}\n` +
    `${s.entregado.length} productos. Ve marcando lo que ha sobrado.`
  );
  s.idx = 0;
  await preguntarProducto(ctx);
}

async function preguntarProducto(ctx: BotContext): Promise<void> {
  const s = ctx.session.sobra;
  if (!s?.entregado || s.idx === undefined) return;

  if (s.idx >= s.entregado.length) {
    await confirmar(ctx);
    return;
  }
  const p = s.entregado[s.idx]!;
  const opciones = [0, 1, 2, 3, 4, 5].filter(n => n <= p.units);
  const filas: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let i = 0; i < opciones.length; i += 3) {
    filas.push(opciones.slice(i, i + 3).map(n => Markup.button.callback(String(n), `sb_cant|${n}`)));
  }
  filas.push([Markup.button.callback('Otra cantidad', 'sb_manual')]);
  filas.push([Markup.button.callback('⏭️ Del resto no sobró nada', 'sb_fin')]);

  await ctx.reply(
    `${p.producto} — se entregaron ${p.units}\n¿Cuántos han sobrado?`,
    Markup.inlineKeyboard(filas)
  );
}

export async function handleSobrasCantidad(ctx: BotContext, n: number): Promise<void> {
  if (!esStaff(ctx)) return;
  const s = ctx.session.sobra;
  if (!s?.entregado || s.idx === undefined) return;
  const p = s.entregado[s.idx]!;
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
  s.idx = (s.entregado ?? []).length;   // el resto queda a cero
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
    ? `✅ Sobras anotadas — ${s.cliente}, ${formatDateSpanish(s.fecha)}\n\n` +
      s.lineas.map(l => `  ${l.cantidad} × ${l.producto}`).join('\n')
    : `✅ Anotado: no sobró nada en ${s.cliente} el ${formatDateSpanish(s.fecha)}.`;
  if (previa) txt += '\n\n(Sustituye al recuento anterior de ese día.)';

  const cliente = s.cliente;
  delete ctx.session.sobra;
  log('SobraFlow', `Sobras de ${cliente} ${s.fecha} por ${ctx.from?.id}`);
  await ctx.reply(txt, Markup.inlineKeyboard([
    [Markup.button.callback('📊 Ver producción sugerida', `sb_aj|0|${new Date().getDay()}`)],
  ]));
}

// ── Ajuste ────────────────────────────────────────────────────────────────────

export async function handleAjuste(ctx: BotContext, consulta: string, dow: number): Promise<void> {
  if (!esStaff(ctx)) return;
  const entregas = await historico.cargar();
  const todos = historico.clientes(entregas);

  const q = consulta.toLowerCase().trim();
  if (!q) {
    await ctx.reply(
      'Uso: /ajuste <parte del nombre del punto>\nPor ejemplo: /ajuste arco\n\nO elige uno:',
      Markup.inlineKeyboard(
        todos.slice(0, 8).map((c, i) => [Markup.button.callback(c.cliente.slice(0, 60), `sb_aj|${i}|${dow}`)])
      )
    );
    return;
  }
  const encontrados = todos.filter(c => c.cliente.toLowerCase().includes(q));
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
  if (ctx.session.step !== 'sb_awaiting_cantidad') return false;
  if (!ctx.message || !('text' in ctx.message)) return false;
  if (!esStaff(ctx)) return false;

  const n = parseInt((ctx.message as Message.TextMessage).text.trim(), 10);
  if (isNaN(n) || n < 0) {
    await ctx.reply('Escribe un número (0 o más).');
    return true;
  }
  ctx.session.step = 'idle';
  await handleSobrasCantidad(ctx, n);
  return true;
}
