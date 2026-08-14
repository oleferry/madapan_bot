import cron from 'node-cron';
import { Telegraf } from 'telegraf';
import { toZonedTime, format } from 'date-fns-tz';
import * as compras from '../services/comprasService';
import { config } from '../config';
import { log } from '../utils/logger';

// Borrador quincenal de pedidos a proveedor.
//
// El cron corre TODOS los miércoles y es el servicio quien decide si toca
// (13 días desde el último). Contar semanas pares del calendario se
// desincroniza en cuanto el bot se reinicia o un miércoles se salta.

export function scheduleComprasBorrador(bot: Telegraf<never>): void {
  const expr = `0 ${config.comprasHour} * * ${config.comprasDow}`;
  cron.schedule(expr, () => void lanzarBorrador(bot), { timezone: config.timezone });
  log('ComprasJob', `Borrador de pedidos programado: día ${config.comprasDow} a las ${config.comprasHour}:00 (quincenal)`);
}

export async function lanzarBorrador(bot: Telegraf<never>, forzar = false): Promise<void> {
  const hoy = format(toZonedTime(new Date(), config.timezone), 'yyyy-MM-dd', { timeZone: config.timezone });

  if (!forzar && !compras.tocaBorrador(hoy)) {
    log('ComprasJob', `Hoy no toca borrador (último: ${compras.ultimoBorrador()})`);
    return;
  }

  const grupos = compras.agruparPorProveedor();
  if (!grupos.length) {
    log('ComprasJob', 'Toca borrador pero no hay nada apuntado');
    // Se anota igual, para no repetir el aviso cada miércoles.
    compras.anotarBorrador(hoy);
    return;
  }

  const texto = '🛒 Toca pedido quincenal.\n\n' + compras.textoBorrador(grupos) +
    '\n\nRevísalo y envíalo con /compras.';

  for (const chatId of config.adminTelegramIds) {
    try {
      await bot.telegram.sendMessage(chatId, texto);
    } catch (err) {
      log('ComprasJob', `No se pudo avisar a ${chatId}: ${(err as Error).message}`);
    }
  }
  log('ComprasJob', `Borrador enviado: ${grupos.length} proveedor(es)`);
}
