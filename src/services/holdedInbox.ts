import nodemailer from 'nodemailer';
import * as gmail from './gmailSender';
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

function haySmtp(): boolean {
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

export function estaConfigurado(): boolean {
  return Boolean(HOLDED_INBOX) && (haySmtp() || gmail.estaConfigurado());
}

export function queFalta(): string[] {
  const faltan: string[] = [];
  if (!HOLDED_INBOX) faltan.push('HOLDED_INBOX_EMAIL');
  if (!haySmtp() && !gmail.estaConfigurado()) {
    faltan.push('una vía de envío: SMTP_HOST/USER/PASS o GMAIL_REMITENTE');
  }
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
    // Cortos a propósito: se prueban dos puertos, y si uno está filtrado no
    // tiene sentido dejar al usuario esperando medio minuto por cada uno.
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 20000,
  });
}

// Comprueba las vías de envío sin mandar nada. Informa de las dos por
// separado: basta con que una funcione.
export async function probarConexion(): Promise<string> {
  const partes: string[] = [];

  if (haySmtp()) {
    let ok = false;
    for (const puerto of puertosAProbar()) {
      try {
        await transporte(puerto).verify();
        partes.push(`✅ SMTP por el puerto ${puerto}`);
        ok = true;
        break;
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        partes.push(`❌ SMTP ${puerto}: ${e.code ?? e.message}`);
      }
    }
    if (!ok) partes.push('(Railway bloquea el SMTP saliente; se usará Gmail)');
  } else {
    partes.push('⏭️ SMTP sin configurar');
  }

  if (gmail.estaConfigurado()) {
    try {
      partes.push(`✅ Gmail API como ${await gmail.probar()}`);
    } catch (err) {
      partes.push(`❌ Gmail API: ${(err as Error).message}`);
    }
  } else {
    partes.push(`⏭️ Gmail API sin configurar (${gmail.queFalta().join(', ')})`);
  }

  return partes.join('\n');
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

  // La API de Gmail va por HTTPS y es la que funciona desde Railway, así que
  // se prueba primero. El SMTP queda de reserva para ejecución en local.
  if (gmail.estaConfigurado()) {
    try {
      await gmail.enviar(HOLDED_INBOX, asunto, nombre, pdf);
      return;
    } catch (err) {
      warn('HoldedInbox', `Gmail falló: ${(err as Error).message}`);
      errores.push(`Gmail: ${(err as Error).message}`);
    }
  }

  if (haySmtp()) {
    for (const puerto of puertosAProbar()) {
      try {
        await transporte(puerto).sendMail(mensaje);
        log('HoldedInbox', `Enviado "${nombre}" a ${HOLDED_INBOX} por el puerto ${puerto}`);
        return;
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        warn('HoldedInbox', `Puerto ${puerto} falló: ${e.code ?? ''} ${e.message}`);
        errores.push(`SMTP ${puerto}: ${e.code ?? e.message}`);
      }
    }
  }

  throw new Error(errores.join(' | '));
}
