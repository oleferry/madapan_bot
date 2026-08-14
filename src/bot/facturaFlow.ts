import { Markup } from 'telegraf';
import { Message } from 'telegraf/types';
import { BotContext } from './customerFlows';
import * as extractor from '../services/facturaExtractor';
import * as drive from '../services/driveClient';
import * as holdedInbox from '../services/holdedInbox';
import { fotosAPdf } from '../utils/imagenAPdf';
import { config } from '../config';
import { log, warn, error } from '../utils/logger';

// Facturas y albaranes de proveedor que llegan en papel.
//
// Foto desde el bot → PDF → se leen los datos con Claude → se renombra
// "Proveedor nº-documento fecha" → se archiva en la carpeta del MES de la
// factura en Drive → se manda al buzón de Holded.
//
// Solo staff: son documentos contables.

export interface FacturaSessionData {
  paginas: Array<{ datos: string; mimeType: string }>;   // base64, en orden
  doc?: extractor.DocumentoProveedor;
  pdf?: string;                                          // base64 del PDF montado
}

const MAX_PAGINAS = 8;

function esStaff(ctx: BotContext): boolean {
  return config.adminTelegramIds.includes(String(ctx.from?.id ?? ''));
}

async function descargar(ctx: BotContext, fileId: string): Promise<Buffer> {
  const link = await ctx.telegram.getFileLink(fileId);
  const r = await fetch(link.toString());
  if (!r.ok) throw new Error(`No se pudo descargar el fichero (HTTP ${r.status})`);
  return Buffer.from(await r.arrayBuffer());
}

// ── Entrada: foto ─────────────────────────────────────────────────────────────

export async function handleFoto(ctx: BotContext): Promise<void> {
  if (!esStaff(ctx)) return;
  const msg = ctx.message as Message.PhotoMessage;
  // Telegram manda varias resoluciones; la última es la mayor.
  const foto = msg.photo[msg.photo.length - 1];
  if (!foto) return;

  const sesion = (ctx.session.factura ??= { paginas: [] });
  if (sesion.paginas.length >= MAX_PAGINAS) {
    await ctx.reply(`Ya hay ${MAX_PAGINAS} páginas. Procesa lo que tienes antes de añadir más.`);
    return;
  }

  try {
    const buffer = await descargar(ctx, foto.file_id);
    sesion.paginas.push({ datos: buffer.toString('base64'), mimeType: 'image/jpeg' });
  } catch (err) {
    warn('FacturaFlow', `Descarga fallida: ${(err as Error).message}`);
    await ctx.reply('No he podido descargar la foto. Inténtalo de nuevo.');
    return;
  }

  const n = sesion.paginas.length;
  await ctx.reply(
    `📄 Página ${n} recibida.\n\n` +
    (n === 1
      ? 'Si la factura tiene más hojas, mándalas ahora. Cuando estén todas, pulsa Procesar.'
      : `Llevas ${n} páginas en este documento.`),
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ Procesar documento', 'fac_procesar')],
      [Markup.button.callback('✖️ Descartar', 'fac_descartar')],
    ])
  );
}

// ── Entrada: PDF ya digital ───────────────────────────────────────────────────

export async function handleDocumento(ctx: BotContext): Promise<boolean> {
  if (!esStaff(ctx)) return false;
  const doc = (ctx.message as Message.DocumentMessage).document;
  if (doc?.mime_type !== 'application/pdf') return false;

  await ctx.reply('📄 PDF recibido. Leyendo los datos...');
  try {
    const pdf = await descargar(ctx, doc.file_id);
    ctx.session.factura = { paginas: [], pdf: pdf.toString('base64') };
    await procesar(ctx, pdf, 'application/pdf');
  } catch (err) {
    error('FacturaFlow', `PDF fallido: ${(err as Error).message}`);
    await ctx.reply(`No he podido procesarlo: ${(err as Error).message}`);
  }
  return true;
}

// ── Procesar: montar el PDF y extraer ─────────────────────────────────────────

export async function handleProcesar(ctx: BotContext): Promise<void> {
  if (!esStaff(ctx)) return;
  const sesion = ctx.session.factura;
  if (!sesion?.paginas.length) {
    await ctx.reply('No hay ninguna foto pendiente. Manda primero la foto de la factura.');
    return;
  }

  await ctx.reply(`Montando el PDF (${sesion.paginas.length} pág.) y leyendo los datos...`);
  try {
    const pdf = await fotosAPdf(
      sesion.paginas.map(p => ({ buffer: Buffer.from(p.datos, 'base64'), mimeType: p.mimeType }))
    );
    sesion.pdf = pdf.toString('base64');
    await procesar(ctx, pdf, 'application/pdf');
  } catch (err) {
    error('FacturaFlow', `Procesado fallido: ${(err as Error).message}`);
    await ctx.reply(`No he podido leer el documento: ${(err as Error).message}`);
  }
}

async function procesar(ctx: BotContext, pdf: Buffer, mimeType: string): Promise<void> {
  const doc = await extractor.extraerDocumento(pdf, mimeType);
  const sesion = (ctx.session.factura ??= { paginas: [] });
  sesion.doc = doc;

  const descuadres = extractor.lineasQueNoCuadran(doc);
  const nombre = extractor.nombreArchivo(doc);
  const { anio, mes } = extractor.mesDelDocumento(doc);

  let txt = `${doc.tipo === 'albaran' ? '📋 ALBARÁN' : '🧾 FACTURA'}\n\n`;
  txt += `Proveedor: ${doc.proveedor}`;
  if (doc.nombre_comercial && doc.nombre_comercial !== doc.proveedor) {
    txt += ` (${doc.nombre_comercial})`;
  }
  txt += '\n';
  txt += `Número: ${doc.num_documento}\n`;
  txt += `Fecha: ${doc.fecha}\n`;
  if (doc.total) txt += `Total: ${doc.total.toFixed(2)} €\n`;
  txt += `Líneas: ${doc.lineas.length}\n\n`;
  txt += `Se archivará como:\n"${nombre}"\nen ${anio}/${mes}\n`;

  if (descuadres.length) {
    // Aritmética que no cuadra = dato mal leído. Mejor avisar que archivar
    // en silencio algo inventado.
    txt += `\n⚠️ ${descuadres.length} línea(s) donde cantidad × precio no da el importe:\n`;
    for (const l of descuadres.slice(0, 5)) {
      txt += `  · ${l.descripcion}: ${l.cantidad} × ${l.precio_unitario} ≠ ${l.importe}\n`;
    }
    txt += 'Revisa el papel antes de archivarlo.\n';
  }

  if (!holdedInbox.estaConfigurado()) {
    txt += `\nℹ️ El envío a Holded está sin configurar (faltan ${holdedInbox.queFalta().join(', ')}). ` +
      'Se archivará en Drive igualmente.';
  }

  await ctx.reply(txt, Markup.inlineKeyboard([
    [Markup.button.callback('📤 Archivar y enviar', 'fac_archivar')],
    [Markup.button.callback('✖️ Descartar', 'fac_descartar')],
  ]));
}

// ── Archivar ──────────────────────────────────────────────────────────────────

export async function handleArchivar(ctx: BotContext): Promise<void> {
  if (!esStaff(ctx)) return;
  const sesion = ctx.session.factura;
  if (!sesion?.doc || !sesion.pdf) {
    await ctx.reply('Ese documento ya no está en curso. Vuelve a mandar la foto.');
    return;
  }

  const doc = sesion.doc;
  const pdf = Buffer.from(sesion.pdf, 'base64');
  const nombre = extractor.nombreArchivo(doc);
  const { anio, mes } = extractor.mesDelDocumento(doc);
  const raiz = doc.tipo === 'albaran' && config.driveAlbaranesFolderId
    ? config.driveAlbaranesFolderId
    : config.driveFacturasFolderId;

  await ctx.reply('Archivando...');

  let resultado = '';
  try {
    const subida = await drive.subirFactura(pdf, nombre, anio, mes, raiz);
    resultado += `✅ Guardado en Drive (${subida.carpeta})\n`;
    if (subida.webViewLink) resultado += `${subida.webViewLink}\n`;
  } catch (err) {
    error('FacturaFlow', `Drive falló: ${(err as Error).message}`);
    resultado += `❌ Drive: ${(err as Error).message}\n`;
  }

  // Los albaranes no van a Holded: allí entra la factura, que es el documento
  // contable. El albarán se archiva para poder cotejarlo después.
  if (doc.tipo === 'factura') {
    if (holdedInbox.estaConfigurado()) {
      try {
        await holdedInbox.enviarAHolded(pdf, nombre, `Factura ${doc.proveedor} ${doc.num_documento}`);
        resultado += '✅ Enviado a Holded\n';
      } catch (err) {
        error('FacturaFlow', `Holded falló: ${(err as Error).message}`);
        resultado += `❌ Holded: ${(err as Error).message}\n`;
      }
    } else {
      resultado += `⏭️ Holded: sin configurar (${holdedInbox.queFalta().join(', ')})\n`;
    }
  }

  delete ctx.session.factura;
  log('FacturaFlow', `Archivado ${nombre} por ${ctx.from?.id}`);
  await ctx.reply(resultado);
}

export async function handleDescartar(ctx: BotContext): Promise<void> {
  delete ctx.session.factura;
  await ctx.reply('Descartado. No se ha archivado nada.');
}
