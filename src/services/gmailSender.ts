import { gmail, auth as gauth } from '@googleapis/gmail';
import { config } from '../config';
import { log } from '../utils/logger';

// Envío de correo por la API de Gmail, sobre HTTPS.
//
// Existe porque Railway bloquea el SMTP saliente: desde el contenedor, tanto
// el 587 como el 465 dan ETIMEDOUT contra smtp.dondominio.com, mientras que
// desde un portátil autentican sin problema. No es cosa de DonDominio.
//
// Reutiliza las mismas credenciales OAuth que Drive, con el scope añadido
// gmail.send. Ese scope solo permite ENVIAR: no da acceso a leer el buzón.

export function estaConfigurado(): boolean {
  return Boolean(
    config.googleOauthClientId && config.googleOauthClientSecret &&
    config.googleOauthRefreshToken && config.gmailRemitente
  );
}

export function queFalta(): string[] {
  const faltan: string[] = [];
  if (!config.googleOauthClientId) faltan.push('GOOGLE_OAUTH_CLIENT_ID');
  if (!config.googleOauthClientSecret) faltan.push('GOOGLE_OAUTH_CLIENT_SECRET');
  if (!config.googleOauthRefreshToken) faltan.push('GOOGLE_OAUTH_REFRESH_TOKEN');
  if (!config.gmailRemitente) faltan.push('GMAIL_REMITENTE');
  return faltan;
}

function api(): ReturnType<typeof gmail> {
  const cliente = new gauth.OAuth2(config.googleOauthClientId, config.googleOauthClientSecret);
  cliente.setCredentials({ refresh_token: config.googleOauthRefreshToken });
  return gmail({ version: 'v1', auth: cliente });
}

// Cabecera con texto no ASCII (acentos del nombre del proveedor): RFC 2047.
function cabecera(v: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7F]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, 'utf-8').toString('base64')}?=`;
}

function construirMime(para: string, asunto: string, nombre: string, pdf: Buffer): string {
  const sep = '=_madapan_' + pdf.length.toString(36);
  return [
    `From: ${config.gmailRemitente}`,
    `To: ${para}`,
    `Subject: ${cabecera(asunto)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${sep}"`,
    '',
    `--${sep}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    'Documento enviado automáticamente desde el bot de Madapan.',
    '',
    `--${sep}`,
    `Content-Type: application/pdf; name="${cabecera(nombre)}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${cabecera(nombre)}"`,
    '',
    pdf.toString('base64').replace(/(.{76})/g, '$1\n'),
    '',
    `--${sep}--`,
  ].join('\r\n');
}

export async function enviar(para: string, asunto: string, nombre: string, pdf: Buffer): Promise<void> {
  if (!estaConfigurado()) {
    throw new Error(`Faltan variables: ${queFalta().join(', ')}`);
  }
  const raw = Buffer.from(construirMime(para, asunto, nombre, pdf))
    .toString('base64url');
  await api().users.messages.send({ userId: 'me', requestBody: { raw } });
  log('GmailSender', `Enviado "${nombre}" a ${para}`);
}

// Comprueba que el token vale para enviar, sin mandar nada.
export async function probar(): Promise<string> {
  if (!estaConfigurado()) {
    throw new Error(`Faltan variables: ${queFalta().join(', ')}`);
  }
  const r = await api().users.getProfile({ userId: 'me' });
  return r.data.emailAddress ?? '(desconocido)';
}
