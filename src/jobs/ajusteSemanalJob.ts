import cron from 'node-cron';
import { Telegraf, Markup, Telegram } from 'telegraf';
import { toZonedTime, format } from 'date-fns-tz';
import * as historico from '../services/historicoVentas';
import * as ps from '../services/pedidosSemanaService';
import * as aj from '../services/ajusteSemanalService';
import * as tickets from '../services/ticketsService';
import { config } from '../config';
import { log, error } from '../utils/logger';

// Revisión semanal de los albaranes: cuánto se sirvió, cuánto volvió, y qué
// cantidad tocaría poner en la hoja.
//
// Corre el día ANTERIOR a la carga semanal para que dé tiempo a revisarlo y
// aplicarlo antes de que los pedidos suban a Holded.
//
// No escribe nada por su cuenta: manda la propuesta con un botón.

// Nada de promediar meses: se compara contra el MISMO día de la semana
// pasada, que además es la que está escrita en la hoja. Promediar mezclaría
// agosto en los pueblos (temporada alta) con el resto del año, y en la ciudad
// justo al revés: la media saldría de dos realidades distintas y no
// describiría ninguna.

let propuesta: { cambios: ps.Cambio[]; generadaEl: string } | null = null;

export function scheduleAjusteSemanal(bot: Telegraf<never>): void {
  const dia = (config.weeklyOrdersDow + 6) % 7;      // el día antes de cargar
  cron.schedule(`0 ${config.comprasHour} * * ${dia}`, () => void revisarYAvisar(bot.telegram),
    { timezone: config.timezone });
  log('AjusteSemanalJob', `Revisión de albaranes programada: día ${dia} a las ${config.comprasHour}:00`);
}

// Recibe el "telegram" y no el bot entero: así vale igual desde el cron que
// desde un comando, donde solo hay ctx.telegram.
export async function revisarYAvisar(telegram: Telegram, detalle = false): Promise<string> {
  const hoy = format(toZonedTime(new Date(), config.timezone), 'yyyy-MM-dd', { timeZone: config.timezone });

  // Se fuerza la descarga: la revisión mira los albaranes de esta semana, no
  // una caché de hace días.
  const entregas = await historico.cargar(true);
  const filas = await ps.leer();

  // Ventas del mostrador de la última semana: para la tienda es el dato bueno,
  // porque dice lo vendido sin que nadie tenga que contar sobras.
  const hace10 = new Date(`${hoy}T12:00:00Z`);
  hace10.setUTCDate(hace10.getUTCDate() - 10);
  const ventasMostrador = await tickets.ventasDesde(hace10.toISOString().slice(0, 10));

  // Un cliente que no devolvió nada en dos meses tiene pedido fijo: se le
  // sirve lo mismo cada día y lo vende. Ajustarle la cantidad por lo de una
  // semana es meterse donde no toca, y fue el fallo del primer día de uso.
  const haceDosMeses = new Date(`${hoy}T12:00:00Z`);
  haceDosMeses.setUTCDate(haceDosMeses.getUTCDate() - 60);
  const fijos = aj.clientesFijos(entregas, haceDosMeses.toISOString().slice(0, 10));

  const { cambios, bruscos, sinDato, fijos: fijosTocados } =
    aj.revisarSemanaAnterior(entregas, filas, hoy, { ventasMostrador, fijos });

  propuesta = cambios.length ? { cambios, generadaEl: hoy } : null;

  let texto = '📉 *AJUSTE SEGÚN LA SEMANA PASADA*\n\n';
  texto += '(lo servido menos lo devuelto, +10 %; sin devoluciones sube el 10 %)\n\n';
  if (!cambios.length && !bruscos.length) {
    texto += 'Las cantidades de la hoja cuadran con lo que se vendió. No hay nada que tocar.';
  } else {
    texto += 'Así quedaría Pedidos_semana:\n\n' + aj.previsualizar(filas, cambios);
    const menos = cambios.reduce((t, c) => t + Math.max(0, c.actual - c.nuevo), 0);
    const mas = cambios.reduce((t, c) => t + Math.max(0, c.nuevo - c.actual), 0);
    texto += `

En total: ${menos} pieza(s) menos y ${mas} más a la semana.`;
    if (bruscos.length) {
      // No se listan uno a uno: son pedidos puntuales que se salen de lo
      // normal (una comunión, un encargo grande), no la base semanal. Verlos
      // enteros cada semana es ruido; lo útil es saber que están ahí.
      const puntos = [...new Set(bruscos.map(c => c.punto.split(/[-(]/)[0]!.trim()))];
      texto += `

⚠️ ${bruscos.length} día(s) con pedidos fuera de lo normal, no se tocan: ` +
        puntos.slice(0, 6).join(', ') + (puntos.length > 6 ? ` y ${puntos.length - 6} más` : '') +
        '.\nSon puntuales, no la base semanal. Para verlos: /revisar_ventas detalle';
      if (detalle) texto += '\n\n' + ps.textoCambios(bruscos);
    }
  }
  if (fijosTocados.length) {
    texto += `

🔒 Pedido fijo, no se tocan (nunca devuelven nada): ` +
      fijosTocados.map(p => p.split(/[-(]/)[0]!.trim()).slice(0, 8).join(', ') +
      (fijosTocados.length > 8 ? ` y ${fijosTocados.length - 8} más` : '');
  }
  if (sinDato.length) {
    texto += `

ℹ️ Sin recuento de devoluciones (no se tocan): ${sinDato.slice(0, 8).join('; ')}` +
      (sinDato.length > 8 ? ` y ${sinDato.length - 8} más` : '');
  }

  for (const chatId of config.adminTelegramIds) {
    try {
      for (let i = 0; i < texto.length; i += 3900) {
        await telegram.sendMessage(chatId, texto.slice(i, i + 3900));
      }
      if (cambios.length) {
        await telegram.sendMessage(chatId,
          `¿Aplico los ${cambios.length} cambios en Pedidos_semana?`,
          Markup.inlineKeyboard([
            [Markup.button.callback('✅ Aplicar', 'aj_aplicar')],
            [Markup.button.callback('✖️ Dejarlo', 'aj_no')],
          ]));
      }
    } catch (err) {
      error('AjusteSemanalJob', `No se pudo avisar a ${chatId}: ${(err as Error).message}`);
    }
  }
  return texto;
}

export function propuestaPendiente(): ps.Cambio[] {
  return propuesta?.cambios ?? [];
}

export function descartarPropuesta(): void {
  propuesta = null;
}
