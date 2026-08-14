import { Markup } from 'telegraf';
import { Message } from 'telegraf/types';
import { BotContext } from './customerFlows';
import * as encargos from '../services/encargosService';
import { formatDateSpanish, getTodayDate } from '../utils/dates';
import { config } from '../config';
import { log } from '../utils/logger';

// Alta de encargos sueltos desde el bot: lo que hoy se apunta a mano en el
// grupo de WhatsApp. Solo staff — es quien lo lleva hoy.
//
// El cliente se identifica por MÓVIL, no por nombre: en el grupo conviven
// "Carlos Magdaleno padre" y "Carlos Magdaleno hijo", y apodos como "Zamora"
// o "Mavi" que no son nombres. Ver docs/encargos-sueltos.md.

export interface EncargoSessionData {
  fecha?: string;
  telefono?: string;
  nombre?: string;
  lineas: encargos.EncargoLinea[];
  // Línea en construcción
  producto?: string;
  cantidad?: number;
  notaRecogida?: string;
}

// Catálogo del encargo. No sale de data/catalog.json, que solo tiene los 20
// productos del pedido B2B semanal. Los nombres están escritos EXACTAMENTE
// como están en Holded para poder enlazarlos por SKU en la fase 3; el único
// que todavía no existe allí es la tarta de limón.
const CATEGORIAS: Array<{ nombre: string; productos: string[] }> = [
  {
    nombre: '🥖 Pan',
    // "barras grandes" y "pan de cuadros grande" del grupo de WhatsApp son
    // estos: en Holded la grande es la normal, y lo que hay por encima es XL.
    productos: ['Barra', 'Barra pequeña', 'Barra bocadillo', 'Chapata',
      'Pan de cuadros', 'Pan de cuadros pequeño', 'Pan de cuadros XL',
      'Mini pan de cuadros', 'Hogaza', 'Hogaza MM centeno', 'Pan de semillas',
      'Pan Integral', 'Pan de canteros', 'Pan pasas y nueces', 'Barra de picos'],
  },
  {
    nombre: '🍪 Dulces',
    productos: ['Caja de magdalenas de 1/2kg', 'Pastas de Lola 500 gr',
      'Rosquillas 500gr', 'Rosquillas 1kg', 'Torta de aceite', 'Torta azúcar',
      'Bizcocho', 'Bizcocho con nueces', 'Bizcocho con chocolate'],
  },
  {
    nombre: '🧁 Repostería',
    productos: ['Donut’s pink', 'Dónuts glass', 'Pain au chocolat',
      'Panettone clásico', 'Panettone chocolate', 'Tarta de limón'],
  },
  {
    nombre: '🥟 Empanadas',
    // Las cuatro por relleno, a 20 €/kg. El peso varía por pieza, así que la
    // cantidad que se apunta aquí son PIEZAS; el kilaje se ve al pesarla.
    productos: ['Empanada de atún y pisto', 'Empanada de bonito',
      'Empanada de bacon, queso y pimientos', 'Empanada de cecina',
      'Empanada completa', 'Empanada 100gr', 'Porción empanada 150 g'],
  },
  {
    nombre: '🍖 Asados',
    productos: ['Asado'],
  },
];

// Mismo criterio que en las reservas de pizza: sin un móvil válido no hay
// cliente recurrente ni forma de avisar de nada.
function esTelefonoValido(v: string): boolean {
  const limpio = v.replace(/[\s.\-()]/g, '');
  return /^(\+34|0034|34)?[6-9]\d{8}$/.test(limpio);
}

function esStaff(ctx: BotContext): boolean {
  return config.adminTelegramIds.includes(String(ctx.from?.id ?? ''));
}

function proximosDias(n = 7): string[] {
  const hoy = getTodayDate();
  const base = new Date(`${hoy}T12:00:00`);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

// ── Inicio ────────────────────────────────────────────────────────────────────

export async function handleEncargoStart(ctx: BotContext): Promise<void> {
  if (!esStaff(ctx)) return;
  ctx.session.encargo = { lineas: [] };
  ctx.session.step = 'idle';

  const botones = proximosDias().map(f => [
    Markup.button.callback(formatDateSpanish(f), `enc_dia|${f}`),
  ]);
  await ctx.reply('📝 Nuevo encargo\n\n¿Para qué día es?', Markup.inlineKeyboard(botones));
}

export async function handleEncargoDia(ctx: BotContext, fecha: string): Promise<void> {
  if (!esStaff(ctx)) return;
  const s = (ctx.session.encargo ??= { lineas: [] });
  s.fecha = fecha;
  await pedirCliente(ctx);
}

// ── Cliente ───────────────────────────────────────────────────────────────────

async function pedirCliente(ctx: BotContext): Promise<void> {
  const habituales = encargos.listarClientes().slice(0, 8);
  const botones = habituales.map(c => [
    Markup.button.callback(`${c.nombre} (${c.totalEncargos})`, `enc_cli|${c.telefono}`),
  ]);
  botones.push([Markup.button.callback('➕ Cliente nuevo', 'enc_nuevo')]);

  await ctx.reply(
    habituales.length
      ? '¿De quién es el encargo?\n\nEntre paréntesis, cuántos encargos lleva.'
      : 'Todavía no hay clientes guardados. Vamos a dar de alta el primero.',
    Markup.inlineKeyboard(botones)
  );
  if (!habituales.length) await pedirTelefono(ctx);
}

export async function handleEncargoClienteNuevo(ctx: BotContext): Promise<void> {
  if (!esStaff(ctx)) return;
  await pedirTelefono(ctx);
}

async function pedirTelefono(ctx: BotContext): Promise<void> {
  ctx.session.step = 'enc_awaiting_phone';
  await ctx.reply('Móvil del cliente (9 dígitos). Es lo que lo identifica: si vuelve a encargar, lo reconoceremos por él.');
}

export async function handleEncargoCliente(ctx: BotContext, telefono: string): Promise<void> {
  if (!esStaff(ctx)) return;
  const s = (ctx.session.encargo ??= { lineas: [] });
  const cliente = encargos.buscarCliente(telefono);
  if (!cliente) {
    await ctx.reply('Ese cliente ya no está. Dame el móvil.');
    await pedirTelefono(ctx);
    return;
  }
  s.telefono = cliente.telefono;
  s.nombre = cliente.nombre;
  let txt = `Cliente: ${cliente.nombre}`;
  if (cliente.notaHabitual) txt += `\n⚠️ Nota habitual: ${cliente.notaHabitual}`;
  await ctx.reply(txt);
  await pedirCategoria(ctx);
}

// ── Producto ──────────────────────────────────────────────────────────────────

async function pedirCategoria(ctx: BotContext): Promise<void> {
  ctx.session.step = 'idle';
  const botones = CATEGORIAS.map((c, i) => [Markup.button.callback(c.nombre, `enc_cat|${i}`)]);
  await ctx.reply('¿Qué quiere?', Markup.inlineKeyboard(botones));
}

export async function handleEncargoCategoria(ctx: BotContext, catIdx: number): Promise<void> {
  if (!esStaff(ctx)) return;
  const cat = CATEGORIAS[catIdx];
  if (!cat) return;
  const botones = cat.productos.map((p, i) => [Markup.button.callback(p, `enc_prod|${catIdx}|${i}`)]);
  botones.push([Markup.button.callback('⬅️ Otra categoría', 'enc_cats')]);
  await ctx.reply(cat.nombre, Markup.inlineKeyboard(botones));
}

export async function handleEncargoCategorias(ctx: BotContext): Promise<void> {
  if (!esStaff(ctx)) return;
  await pedirCategoria(ctx);
}

export async function handleEncargoProducto(ctx: BotContext, catIdx: number, prodIdx: number): Promise<void> {
  if (!esStaff(ctx)) return;
  const producto = CATEGORIAS[catIdx]?.productos[prodIdx];
  if (!producto) return;
  const s = (ctx.session.encargo ??= { lineas: [] });
  s.producto = producto;

  const fila = (ns: number[]): ReturnType<typeof Markup.button.callback>[] =>
    ns.map(n => Markup.button.callback(String(n), `enc_cant|${n}`));
  await ctx.reply(
    `${producto}\n¿Cuántos?`,
    Markup.inlineKeyboard([
      fila([1, 2, 3, 4]),
      fila([5, 6, 10, 12]),
      [Markup.button.callback('Otra cantidad', 'enc_cant_manual')],
    ])
  );
}

export async function handleEncargoCantidad(ctx: BotContext, cantidad: number): Promise<void> {
  if (!esStaff(ctx)) return;
  const s = ctx.session.encargo;
  if (!s?.producto) return;
  s.cantidad = cantidad;
  ctx.session.step = 'enc_awaiting_nota';
  await ctx.reply(
    `${cantidad} × ${s.producto}\n\n¿Alguna indicación para el obrador? (por ejemplo "pocos hechos")`,
    Markup.inlineKeyboard([[Markup.button.callback('Sin indicaciones', 'enc_nota_no')]])
  );
}

export async function handleEncargoCantidadManual(ctx: BotContext): Promise<void> {
  if (!esStaff(ctx)) return;
  ctx.session.step = 'enc_awaiting_cantidad';
  await ctx.reply('Escribe la cantidad.');
}

function cerrarLinea(ctx: BotContext, nota?: string): void {
  const s = ctx.session.encargo;
  if (!s?.producto || !s.cantidad) return;
  s.lineas.push({ producto: s.producto, cantidad: s.cantidad, ...(nota ? { nota } : {}) });
  delete s.producto;
  delete s.cantidad;
}

async function preguntarMas(ctx: BotContext): Promise<void> {
  const s = ctx.session.encargo;
  ctx.session.step = 'idle';
  const resumen = (s?.lineas ?? [])
    .map(l => `  ${l.cantidad} × ${l.producto}${l.nota ? ` (${l.nota})` : ''}`)
    .join('\n');
  await ctx.reply(
    `Va quedando así:\n${resumen}`,
    Markup.inlineKeyboard([
      [Markup.button.callback('➕ Añadir otro producto', 'enc_mas')],
      [Markup.button.callback('✅ Terminar', 'enc_fin')],
    ])
  );
}

export async function handleEncargoNotaNo(ctx: BotContext): Promise<void> {
  if (!esStaff(ctx)) return;
  cerrarLinea(ctx);
  await preguntarMas(ctx);
}

export async function handleEncargoMas(ctx: BotContext): Promise<void> {
  if (!esStaff(ctx)) return;
  await pedirCategoria(ctx);
}

// ── Cierre ────────────────────────────────────────────────────────────────────

export async function handleEncargoFin(ctx: BotContext): Promise<void> {
  if (!esStaff(ctx)) return;
  if (!ctx.session.encargo?.lineas.length) {
    await ctx.reply('El encargo está vacío. Añade al menos un producto.');
    return;
  }
  ctx.session.step = 'enc_awaiting_recogida';
  await ctx.reply(
    '¿Algo sobre la recogida? (por ejemplo "lo recoge con las pizzas a las 21:00")',
    Markup.inlineKeyboard([[Markup.button.callback('Sin nota de recogida', 'enc_rec_no')]])
  );
}

async function confirmar(ctx: BotContext): Promise<void> {
  const s = ctx.session.encargo;
  if (!s?.fecha || !s.telefono || !s.nombre) return;
  let txt = `📝 Encargo de ${s.nombre} (${s.telefono})\n`;
  txt += `Para el ${formatDateSpanish(s.fecha)}\n\n`;
  for (const l of s.lineas) txt += `  ${l.cantidad} × ${l.producto}${l.nota ? ` — ${l.nota}` : ''}\n`;
  if (s.notaRecogida) txt += `\nRecogida: ${s.notaRecogida}\n`;
  ctx.session.step = 'idle';
  await ctx.reply(txt, Markup.inlineKeyboard([
    [Markup.button.callback('✅ Guardar', 'enc_ok')],
    [Markup.button.callback('✖️ Descartar', 'enc_no')],
  ]));
}

export async function handleEncargoRecogidaNo(ctx: BotContext): Promise<void> {
  if (!esStaff(ctx)) return;
  await confirmar(ctx);
}

export async function handleEncargoGuardar(ctx: BotContext): Promise<void> {
  if (!esStaff(ctx)) return;
  const s = ctx.session.encargo;
  if (!s?.fecha || !s.telefono || !s.nombre || !s.lineas.length) {
    await ctx.reply('Ese encargo ya no está en curso. Empieza de nuevo con /encargo.');
    return;
  }
  const e = encargos.crearEncargo({
    fecha: s.fecha,
    telefono: s.telefono,
    nombre: s.nombre,
    lineas: s.lineas,
    ...(s.notaRecogida ? { notaRecogida: s.notaRecogida } : {}),
    creadoPor: String(ctx.from?.id ?? ''),
  });
  delete ctx.session.encargo;
  log('EncargoFlow', `Encargo ${e.id} creado por ${ctx.from?.id}`);
  await ctx.reply(
    `✅ Encargo ${e.id} guardado para el ${formatDateSpanish(e.fecha)}.\n\n` +
    'Ya aparece en la producción de ese día.',
    Markup.inlineKeyboard([[Markup.button.callback('➕ Otro encargo', 'enc_nuevo_encargo')]])
  );
}

export async function handleEncargoDescartar(ctx: BotContext): Promise<void> {
  delete ctx.session.encargo;
  ctx.session.step = 'idle';
  await ctx.reply('Encargo descartado. No se ha guardado nada.');
}

// ── Ver y cancelar los del día ────────────────────────────────────────────────

export async function handleEncargosDelDia(ctx: BotContext, fecha: string): Promise<void> {
  if (!esStaff(ctx)) return;
  const lista = encargos.encargosDelDia(fecha);
  if (!lista.length) {
    await ctx.reply(`No hay encargos para el ${formatDateSpanish(fecha)}.`);
    return;
  }
  for (const e of lista) {
    let txt = `${e.id} — ${e.nombre} (${e.telefono})\n`;
    for (const l of e.lineas) txt += `  ${l.cantidad} × ${l.producto}${l.nota ? ` — ${l.nota}` : ''}\n`;
    if (e.notaRecogida) txt += `Recogida: ${e.notaRecogida}\n`;
    await ctx.reply(txt, Markup.inlineKeyboard([
      [Markup.button.callback('✖️ Cancelar este encargo', `enc_cancel|${e.id}`)],
    ]));
  }
}

export async function handleEncargoCancelar(ctx: BotContext, id: string): Promise<void> {
  if (!esStaff(ctx)) return;
  const e = encargos.cancelarEncargo(id);
  await ctx.reply(e
    ? `✅ Encargo ${id} cancelado. Ya no cuenta para la producción del ${formatDateSpanish(e.fecha)}.`
    : `No he encontrado el encargo ${id} (o ya estaba cancelado).`);
}

// ── Texto libre ───────────────────────────────────────────────────────────────

// Devuelve true si el mensaje pertenece a este flujo (y ya se ha respondido).
export async function handleEncargoText(ctx: BotContext): Promise<boolean> {
  if (!ctx.message || !('text' in ctx.message)) return false;
  const paso = ctx.session.step;
  if (!paso?.startsWith('enc_')) return false;
  if (!esStaff(ctx)) return false;

  const texto = (ctx.message as Message.TextMessage).text.trim();
  const s = (ctx.session.encargo ??= { lineas: [] });

  if (paso === 'enc_awaiting_phone') {
    if (!esTelefonoValido(texto)) {
      await ctx.reply('Ese móvil no parece válido. Escribe 9 dígitos (por ejemplo 612345678).');
      return true;
    }
    s.telefono = encargos.normalizarTelefono(texto);
    const existente = encargos.buscarCliente(s.telefono);
    if (existente) {
      // Mismo móvil = mismo cliente, aunque en el grupo lo llamen de otra forma.
      s.nombre = existente.nombre;
      ctx.session.step = 'idle';
      await ctx.reply(`Ese móvil ya es de ${existente.nombre} (${existente.totalEncargos} encargos).`);
      await pedirCategoria(ctx);
      return true;
    }
    ctx.session.step = 'enc_awaiting_name';
    await ctx.reply('¿Cómo se llama? Vale el nombre con el que lo conocemos ("Zamora", "Carlos Magdaleno padre").');
    return true;
  }

  if (paso === 'enc_awaiting_name') {
    s.nombre = texto;
    ctx.session.step = 'idle';
    await pedirCategoria(ctx);
    return true;
  }

  if (paso === 'enc_awaiting_cantidad') {
    const n = parseInt(texto.replace(',', '.'), 10);
    if (isNaN(n) || n <= 0) {
      await ctx.reply('Escribe un número mayor que 0.');
      return true;
    }
    await handleEncargoCantidad(ctx, n);
    return true;
  }

  if (paso === 'enc_awaiting_nota') {
    cerrarLinea(ctx, texto);
    await preguntarMas(ctx);
    return true;
  }

  if (paso === 'enc_awaiting_recogida') {
    s.notaRecogida = texto;
    await confirmar(ctx);
    return true;
  }

  return false;
}
