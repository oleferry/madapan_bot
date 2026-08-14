import nodemailer from 'nodemailer';
import { log } from '../utils/logger';

// Envío de la factura al buzón de Holded ("Inbox" / recepción de documentos).
//
// Va por correo y no por API a propósito: la creación de documentos de compra
// por API solo admite un vencimiento, y hay proveedores que facturan a varios.
// Mandándolo al buzón, Holded lo procesa como si hubiera entrado por su propio
// escáner y conserva los vencimientos.

const SMTP_HOST = process.env['SMTP_HOST'] ?? '';
const SMTP_PORT = parseInt(process.env['SMTP_PORT'] ?? '587', 10);
const SMTP_USER = process.env['SMTP_USER'] ?? '';
const SMTP_PASS = process.env['SMTP_PASS'] ?? '';
const HOLDED_INBOX = process.env['HOLDED_INBOX_EMAIL'] ?? '';

export function estaConfigurado(): boolean {
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS && HOLDED_INBOX);
}

export function queFalta(): string[] {
  const faltan: string[] = [];
  if (!SMTP_HOST) faltan.push('SMTP_HOST');
  if (!SMTP_USER) faltan.push('SMTP_USER');
  if (!SMTP_PASS) faltan.push('SMTP_PASS');
  if (!HOLDED_INBOX) faltan.push('HOLDED_INBOX_EMAIL');
  return faltan;
}

export async function enviarAHolded(pdf: Buffer, nombre: string, asunto: string): Promise<void> {
  if (!estaConfigurado()) {
    throw new Error(`Faltan variables de entorno: ${queFalta().join(', ')}`);
  }
  const transporte = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  await transporte.sendMail({
    from: SMTP_USER,
    to: HOLDED_INBOX,
    subject: asunto,
    text: 'Documento enviado automáticamente desde el bot de Madapan.',
    attachments: [{ filename: nombre, content: pdf, contentType: 'application/pdf' }],
  });
  log('HoldedInbox', `Enviado "${nombre}" a ${HOLDED_INBOX}`);
}
