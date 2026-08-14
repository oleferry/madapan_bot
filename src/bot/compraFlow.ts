import { Markup } from 'telegraf';
import { Message } from 'telegraf/types';
import { BotContext } from './customerFlows';
import * as compras from '../services/comprasService';
import * as holded from '../services/holdedClient';
import * as gmail from '../services/gmailSender';
import { config } from '../config';
import { log, error } from '../utils/logger';

// Lista de la compra: se apunta según se acaba ("/apuntar 24 coca colas") y
// cada dos semanas sale un borrador agrupado por proveedor.
//
// El bot aprende de quién es cada cosa la primera vez que se apunta, porque el
// campo de proveedor de la ficha de artículo de Holded no se puede escribir
// por API. Ver comentario en comprasService.ts.

export interface CompraSessionData {
  cantidad?: number;
  texto?: string;
  producto?: string;
  sku?: string;
  holdedId?: string;
  candidatos?: Array<{ id: string; name: string; sku: string }>;
  proveedores?: Array<{ id: string; name: string; email: string }>;
}

function esStaff(ctx: BotContext): boolean {
  return config.adminTelegramIds.includes(String(ctx.from?.id ?? ''));
}

// "24 coca colas" → 24 + "coca colas". Sin número delante, 1.
export function partir(texto: string): { cantidad: number; consulta: string } {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s+(.*)$/.exec(texto);
  if (!m) return { cantidad: 1, consulta: texto.trim() };
  return { cantidad: parseFloat(m[1]!.replace(',', '.')), consulta: m[2]!.trim() };
}

// ── Apuntar ───────────────────────────────────────────────────────────────────

export async function handleApuntar(ctx: BotContext, texto: string): Promise<void> {
  if (!esStaff(ctx)) return;
  if (!texto.trim()) {
    await ctx.reply('Escribe qué hay que pedir. Por ejemplo: /apuntar 24 coca colas');
    return;
  }

  const { cantidad, consulta } = partir(texto);
  const s: CompraSessionData = { cantidad, texto: texto.trim() };
  ctx.session.compra = s;

  const encontrados = await holded.buscarProductos(consulta);
  s.candidatos = encontrados.map(p => ({ id: p.id, name: p.name, sku: p.sku }));

  if (!encontrados.length) {
    await ctx.reply(
      `No encuentro "${consulta}" en Holded.`,
      Markup.inlineKeyboard([[Markup.button.callback(`Apuntar "${consulta}" tal cual`, 'cmp_libre')]])
    );
    return;
  }

  const botones = encontrados.map((p, i) => [Markup.button.callback(p.name, `cmp_prod|${i}`)]);
  botones.push([Markup.button.callback(`Ninguno: apuntar "${consulta}" tal cual`, 'cmp_libre')]);
  await ctx.reply(`${cantidad} × ¿cuál de estos?`, Markup.inlineKeyboard(botones));
}

export async function handleProductoElegido(ctx: BotContext, idx: number): Promise<void> {
  if (!esStaff(ctx)) return;
  const s = ctx.session.compra;
  const p = s?.candidatos?.[idx];
  if (!s || !p) return;
  s.producto = p.name;
  if (p.sku) s.sku = p.sku;
  s.holdedId = p.id;
  await pedirProveedorSiHaceFalta(ctx);
}

export async function handleApuntarLibre(ctx: BotContext): Promise<void> {
  if (!esStaff(ctx)) return;
  const s = ctx.session.compra;
  if (!s?.texto) return;
  s.producto = partir(s.texto).consulta;
  delete s.sku;
  delete s.holdedId;
  await pedirProveedorSiHaceFalta(ctx);
}

async function pedirProveedorSiHaceFalta(ctx: BotContext): Promise<void> {
  const s = ctx.session.compra;
  if (!s?.producto) return;

  // Si ya se preguntó una vez por este artículo, no se vuelve a preguntar.
  const sabido = compras.proveedorDe(s.producto, s.sku);
  if (sabido) {
    guardar(ctx, sabido.proveedorId, sabido.proveedorNombre);
    return;
  }
  ctx.session.step = 'cmp_awaiting_prov';
  await ctx.reply(
    `${s.producto}: ¿de qué proveedor es?\n\nEscribe parte del nombre. Solo lo pregunto esta vez.`,
    Markup.inlineKeyboard([[Markup.button.callback('No lo sé / lo decido luego', 'cmp_sin_prov')]])
  );
}

export async function handleSinProveedor(ctx: BotContext): Promise<void> {
  if (!esStaff(ctx)) return;
  guardar(ctx);
}

export async function handleProveedorElegido(ctx: BotContext, idx: number): Promise<void> {
  if (!esStaff(ctx)) return;
  const s = ctx.session.compra;
  const p = s?.proveedores?.[idx];
  if (!s || !p || !s.producto) return;
  compras.aprenderProveedor(s.producto, s.sku, p.id, p.name, p.email);
  guardar(ctx, p.id, p.name, p.email ? undefined : p.name);
}

function guardar(ctx: BotContext, proveedorId?: string, proveedorNombre?: string, sinEmail?: string): void {
  const s = ctx.session.compra;
  if (!s?.producto || !s.cantidad) return;
  const a = compras.apuntar({
    texto: s.texto ?? '',
    producto: s.producto,
    cantidad: s.cantidad,
    ...(s.sku ? { sku: s.sku } : {}),
    ...(s.holdedId ? { holdedId: s.holdedId } : {}),
    ...(proveedorId ? { proveedorId } : {}),
    ...(proveedorNombre ? { proveedorNombre } : {}),
    apuntadoPor: String(ctx.from?.id ?? ''),
  });
  delete ctx.session.compra;
  ctx.session.step = 'idle';

  let txt = `✅ Apuntado: ${a.cantidad} × ${a.producto}`;
  txt += proveedorNombre ? `\nProveedor: ${proveedorNombre}` : '\n⚠️ Sin proveedor: habrá que asignarlo al revisar.';
  if (sinEmail) txt += `\n⚠️ ${sinEmail} no tiene email en Holded: ese pedido habrá que mandarlo a mano.`;
  txt += `\n\nPendientes: ${compras.pendientes().length}`;
  void ctx.reply(txt);
}

// ── Ver y revisar ─────────────────────────────────────────────────────────────

export async function handleVerCompras(ctx: BotContext): Promise<void> {
  if (!esStaff(ctx)) return;
  const lista = compras.pendientes();
  if (!lista.length) {
    await ctx.reply('No hay nada apuntado. Se apunta con /apuntar 24 coca colas');
    return;
  }
  await ctx.reply(compras.textoBorrador(compras.agruparPorProveedor()));
  await ctx.reply(
    `${lista.length} apunte(s) pendientes.`,
    Markup.inlineKeyboard([
      [Markup.button.callback('📤 Preparar y enviar pedidos', 'cmp_borrador')],
    ])
  );
}

export async function handleBorrador(ctx: BotContext): Promise<void> {
  if (!esStaff(ctx)) return;
  const grupos = compras.agruparPorProveedor();
  if (!grupos.length) {
    await ctx.reply('No hay nada que pedir.');
    return;
  }
  const enviables = grupos.filter(g => g.proveedorId && g.proveedorEmail);
  const sinEmail = grupos.filter(g => !g.proveedorEmail);

  let txt = compras.textoBorrador(grupos) + '\n\n';
  txt += `Se enviarán ${enviables.length} pedido(s) por correo.`;
  if (sinEmail.length) {
    txt += `\n⚠️ ${sinEmail.map(g => g.proveedorNombre).join(', ')}: sin email. ` +
      'Esos no se envían; se quedan apuntados para pedirlos a mano.';
  }

  await ctx.reply(txt, Markup.inlineKeyboard([
    [Markup.button.callback('✅ Enviar a los proveedores', 'cmp_enviar')],
    [Markup.button.callback('✖️ Ahora no', 'cmp_no')],
  ]));
}

export async function handleCancelarEnvio(ctx: BotContext): Promise<void> {
  await ctx.reply('Vale, no se ha enviado nada. Lo apuntado sigue pendiente.');
}

// ── Enviar ────────────────────────────────────────────────────────────────────

export async function handleEnviarPedidos(ctx: BotContext): Promise<void> {
  if (!esStaff(ctx)) return;
  const grupos = compras.agruparPorProveedor().filter(g => g.proveedorId && g.proveedorEmail);
  if (!grupos.length) {
    await ctx.reply('No hay ningún pedido con proveedor y email. Asigna proveedor primero.');
    return;
  }

  const hoy = new Date().toISOString().slice(0, 10);
  await ctx.reply(`Enviando ${grupos.length} pedido(s)...`);

  for (const g of grupos) {
    let resultado = `— ${g.proveedorNombre} —\n`;

    // Documento de compra en Holded. Sin aprobar: es un borrador que se
    // revisa allí, no un documento definitivo.
    const cuerpo = g.lineas
      .map(l => `  ${l.cantidad} x ${l.producto}${l.notas.length ? ` (${l.notas.join('; ')})` : ''}`)
      .join('\n');
    const idHolded = await holded.createPurchaseOrder(
      g.proveedorId!,
      g.lineas.map(l => ({ name: l.producto, ...(l.sku ? { sku: l.sku } : {}), units: l.cantidad, price: 0 })),
      'Pedido generado automáticamente desde el bot de Madapan.'
    );
    resultado += idHolded ? '✅ Pedido de compra creado en Holded\n' : '⚠️ No se pudo crear en Holded\n';

    try {
      await gmail.enviarTexto(
        g.proveedorEmail!,
        `Pedido Madapan — ${hoy}`,
        `Buenos días:\n\nOs pasamos el siguiente pedido:\n\n${cuerpo}\n\n` +
        'Confirmadnos disponibilidad y fecha de entrega, por favor.\n\n' +
        'Gracias.\nMadapan — Semilla Empresarial, S.L.'
      );
      resultado += `✅ Enviado a ${g.proveedorEmail}`;
      compras.marcarPedidos(g.lineas.flatMap(l => l.ids), hoy);
    } catch (err) {
      error('CompraFlow', `Envío a ${g.proveedorNombre} falló: ${(err as Error).message}`);
      resultado += `❌ Correo: ${(err as Error).message}\nSigue pendiente.`;
    }

    await ctx.reply(resultado);
  }

  compras.anotarBorrador(hoy);
  log('CompraFlow', `Pedidos enviados por ${ctx.from?.id}`);
  const quedan = compras.pendientes().length;
  await ctx.reply(quedan
    ? `Quedan ${quedan} apunte(s) pendientes (sin proveedor o sin email).`
    : 'Todo pedido. La lista queda vacía.');
}

// ── Texto libre ───────────────────────────────────────────────────────────────

export async function handleCompraText(ctx: BotContext): Promise<boolean> {
  if (ctx.session.step !== 'cmp_awaiting_prov') return false;
  if (!ctx.message || !('text' in ctx.message)) return false;
  if (!esStaff(ctx)) return false;

  const texto = (ctx.message as Message.TextMessage).text.trim();
  const s = ctx.session.compra;
  if (!s) return true;

  const encontrados = await holded.buscarProveedores(texto);
  if (!encontrados.length) {
    await ctx.reply(
      `No encuentro ningún proveedor que se parezca a "${texto}". Prueba con otra parte del nombre.`,
      Markup.inlineKeyboard([[Markup.button.callback('Dejarlo sin proveedor', 'cmp_sin_prov')]])
    );
    return true;
  }
  s.proveedores = encontrados.map(p => ({ id: p.id, name: p.name, email: p.email }));
  await ctx.reply('¿Cuál?', Markup.inlineKeyboard(
    encontrados.map((p, i) => [
      Markup.button.callback(p.email ? p.name : `${p.name} (sin email)`, `cmp_prov|${i}`),
    ])
  ));
  return true;
}
