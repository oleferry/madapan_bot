import { Markup } from 'telegraf';
import { Message } from 'telegraf/types';
import { BotContext } from './customerFlows';
import * as inst from '../services/instruccionesService';
import * as ps from '../services/pedidosSemanaService';
import { config } from '../config';
import { log, error } from '../utils/logger';

// Cambios en los pedidos semanales a partir de un mensaje escrito a mano
// ("reducir Villacarralón a 4 panes... Ceinos: quitar los integrales").
//
// Solo se toca la pestaña Pedidos_semana: las demás las calcula la propia
// hoja. Y nunca se escribe sin que un admin vea antes celda por celda lo que
// va a cambiar: el modelo interpreta, pero quien decide es una persona.

export interface InstruccionSessionData {
  cambios?: ps.Cambio[];
  resumen?: string;
}

function esStaff(ctx: BotContext): boolean {
  return config.adminTelegramIds.includes(String(ctx.from?.id ?? ''));
}

export async function handleCambiosStart(ctx: BotContext, texto: string): Promise<void> {
  if (!esStaff(ctx)) return;

  if (!texto.trim()) {
    ctx.session.step = 'ins_awaiting_texto';
    await ctx.reply(
      '📝 Pégame el mensaje con los cambios de la semana.\n\n' +
      'Por ejemplo:\n' +
      '"Reducir Villacarralón a 4 panes y 12 chapatas, no abren los lunes.\n' +
      'Ceinos: quitar los panes integrales."'
    );
    return;
  }
  await procesar(ctx, texto);
}

export async function procesar(ctx: BotContext, texto: string): Promise<void> {
  ctx.session.step = 'idle';
  await ctx.reply('Leyendo el mensaje y comparándolo con la hoja...');

  try {
    const ops = await inst.interpretar(texto);
    if (!ops.length) {
      await ctx.reply('No he sacado ningún cambio de ese mensaje.');
      return;
    }
    const filas = await ps.leer();
    const plan = await inst.construirPlan(ops, filas);

    ctx.session.instruccion = { cambios: plan.cambios, resumen: ps.textoCambios(plan.cambios) };

    const texto2 = inst.textoPlan(plan);
    // Telegram corta a los 4096 caracteres.
    for (let i = 0; i < texto2.length; i += 3900) {
      await ctx.reply(texto2.slice(i, i + 3900));
    }

    if (!plan.cambios.length) {
      await ctx.reply('No hay nada que escribir en la hoja.');
      return;
    }
    await ctx.reply(
      `Son ${plan.cambios.length} celda(s) de Pedidos_semana. ¿Las aplico?`,
      Markup.inlineKeyboard([
        [Markup.button.callback('✅ Aplicar en la hoja', 'ins_aplicar')],
        [Markup.button.callback('✖️ No tocar nada', 'ins_no')],
      ])
    );
  } catch (err) {
    error('InstruccionFlow', `Fallo interpretando: ${(err as Error).message}`);
    await ctx.reply(`No he podido procesarlo: ${(err as Error).message}`);
  }
}

export async function handleAplicar(ctx: BotContext): Promise<void> {
  if (!esStaff(ctx)) return;
  const s = ctx.session.instruccion;
  if (!s?.cambios?.length) {
    await ctx.reply('Ya no tengo esos cambios en memoria. Vuelve a mandarme el mensaje.');
    return;
  }
  await ctx.reply('Escribiendo en la hoja...');
  try {
    await ps.aplicar(s.cambios);
    log('InstruccionFlow', `${s.cambios.length} celdas escritas por ${ctx.from?.id}`);
    delete ctx.session.instruccion;
    await ctx.reply(
      `✅ Hecho: ${s.cambios.length} celda(s) actualizadas en Pedidos_semana.\n\n` +
      'Las demás pestañas se recalculan solas. Revisa con /cargar_semana antes de subir nada a Holded.'
    );
  } catch (err) {
    error('InstruccionFlow', `Fallo escribiendo: ${(err as Error).message}`);
    await ctx.reply(`❌ No he podido escribir en la hoja: ${(err as Error).message}\n\nNo se ha cambiado nada.`);
  }
}

export async function handleCancelar(ctx: BotContext): Promise<void> {
  delete ctx.session.instruccion;
  await ctx.reply('Vale, no he tocado la hoja.');
}

export async function handleInstruccionText(ctx: BotContext): Promise<boolean> {
  if (ctx.session.step !== 'ins_awaiting_texto') return false;
  if (!ctx.message || !('text' in ctx.message)) return false;
  if (!esStaff(ctx)) return false;
  await procesar(ctx, (ctx.message as Message.TextMessage).text);
  return true;
}
