import nodemailer from 'nodemailer';
import { log, warn } from '../utils/logger';

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

// Puertos a probar, en orden. Railway bloquea el 25 de salida y a veces
// también filtra el 587; el 465 (SSL directo) suele pasar. Se intenta el
// configurado primero y luego el otro, en vez de fallar sin más.
function puertosAProbar(): number[] {
  const orden = [SMTP_PORT, SMTP_PORT === 465 ? 587 : 465];
  return [...new Set(orden)];
}

function transporte(puerto: number): nodemailer.Transporter {
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: puerto,
    secure: puerto === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    // Sin esto, un puerto filtrado se queda colgado hasta el timeout del
    // sistema y el bot parece muerto durante minutos.
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
  });
}

// Conecta y autentica sin enviar nada. Devuelve el puerto que funcionó.
export async function probarConexion(): Promise<{ puerto: number; errores: string[] }> {
  if (!estaConfigurado()) {
    throw new Error(`Faltan variables de entorno: ${queFalta().join(', ')}`);
  }
  const errores: string[] = [];
  for (const puerto of puertosAProbar()) {
    try {
      await transporte(puerto).verify();
      return { puerto, errores };
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      errores.push(`${puerto}: ${e.code ?? ''} ${e.message}`.trim());
    }
  }
  throw new Error(errores.join(' | '));
}

export async function enviarAHolded(pdf: Buffer, nombre: string, asunto: string): Promise<void> {
  if (!estaConfigurado()) {
    throw new Error(`Faltan variables de entorno: ${queFalta().join(', ')}`);
  }
  const mensaje = {
    from: SMTP_USER,
    to: HOLDED_INBOX,
    subject: asunto,
    text: 'Documento enviado automáticamente desde el bot de Madapan.',
    attachments: [{ filename: nombre, content: pdf, contentType: 'application/pdf' }],
  };

  const errores: string[] = [];
  for (const puerto of puertosAProbar()) {
    try {
      await transporte(puerto).sendMail(mensaje);
      log('HoldedInbox', `Enviado "${nombre}" a ${HOLDED_INBOX} por el puerto ${puerto}`);
      return;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      warn('HoldedInbox', `Puerto ${puerto} falló: ${e.code ?? ''} ${e.message}`);
      errores.push(`${puerto}: ${e.code ?? e.message}`);
    }
  }
  throw new Error(errores.join(' | '));
}
