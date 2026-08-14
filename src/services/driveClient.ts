import { drive_v3, drive } from '@googleapis/drive';
import { OAuth2Client } from 'google-auth-library';
import { Readable } from 'stream';
import { config } from '../config';
import { log } from '../utils/logger';

// Archivo de facturas en Google Drive.
//
// Va con OAuth de USUARIO, no con la cuenta de servicio que usamos para la hoja
// maestra: una cuenta de servicio no tiene "Mi unidad" y no puede escribir en la
// de una cuenta Gmail normal, solo en unidades compartidas. El refresh token se
// genera una vez con scripts/generar-refresh-token.js.
// Ver docs/credenciales-facturas.md.

// Las carpetas del Drive se llaman AAMM: 2026/2608. Se respeta ese nombre
// aunque no sea el más legible, para no partir en dos el archivo existente.
export function nombreCarpetaMes(anio: string, mes: string): string {
  return `${anio.slice(2)}${mes}`;
}

let api: drive_v3.Drive | null = null;

function getApi(): drive_v3.Drive {
  if (api) return api;
  const { googleOauthClientId, googleOauthClientSecret, googleOauthRefreshToken } = config;
  if (!googleOauthClientId || !googleOauthClientSecret || !googleOauthRefreshToken) {
    throw new Error(
      'Faltan credenciales de Drive (GOOGLE_OAUTH_CLIENT_ID / _SECRET / _REFRESH_TOKEN)'
    );
  }
  const auth = new OAuth2Client(googleOauthClientId, googleOauthClientSecret);
  auth.setCredentials({ refresh_token: googleOauthRefreshToken });
  api = drive({ version: 'v3', auth });
  return api;
}

// Busca una subcarpeta por nombre y la crea si no existe. Devuelve su id.
async function subcarpeta(padreId: string, nombre: string): Promise<string> {
  const d = getApi();
  const q = [
    `'${padreId}' in parents`,
    `name = '${nombre.replace(/'/g, "\\'")}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    'trashed = false',
  ].join(' and ');

  const encontrada = await d.files.list({
    q, fields: 'files(id,name)', pageSize: 1,
    supportsAllDrives: true, includeItemsFromAllDrives: true,
  });
  const existente = encontrada.data.files?.[0]?.id;
  if (existente) return existente;

  const creada = await d.files.create({
    requestBody: { name: nombre, mimeType: 'application/vnd.google-apps.folder', parents: [padreId] },
    fields: 'id', supportsAllDrives: true,
  });
  log('DriveClient', `Carpeta creada: ${nombre}`);
  return creada.data.id!;
}

export interface SubidaDrive {
  fileId: string;
  webViewLink: string;
  carpeta: string;
}

// Sube el PDF a <raíz>/<año>/<mes>. Si el año o el mes no existen, los crea.
export async function subirFactura(
  pdf: Buffer,
  nombre: string,
  anio: string,
  mes: string,
  raizId?: string
): Promise<SubidaDrive> {
  const raiz = raizId || config.driveFacturasFolderId;
  if (!raiz) {
    throw new Error('Falta DRIVE_FACTURAS_FOLDER_ID: no sé en qué carpeta archivar');
  }
  const nombreMes = nombreCarpetaMes(anio, mes);
  const anioId = await subcarpeta(raiz, anio);
  const mesId = await subcarpeta(anioId, nombreMes);

  const r = await getApi().files.create({
    requestBody: { name: nombre, parents: [mesId] },
    media: { mimeType: 'application/pdf', body: Readable.from(pdf) },
    fields: 'id,webViewLink', supportsAllDrives: true,
  });
  log('DriveClient', `Subido "${nombre}" a ${anio}/${nombreMes}`);
  return {
    fileId: r.data.id!,
    webViewLink: r.data.webViewLink ?? '',
    carpeta: `${anio}/${nombreMes}`,
  };
}
