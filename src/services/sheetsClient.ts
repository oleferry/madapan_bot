import { sheets, sheets_v4, auth as gauth } from '@googleapis/sheets';
import { config } from '../config';
import { log } from '../utils/logger';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

let client: sheets_v4.Sheets | null = null;

// La credencial puede venir de dos sitios: el JSON entero en una variable de
// entorno (Railway, donde no podemos dejar ficheros) o un fichero local.
function getAuth(): InstanceType<typeof gauth.GoogleAuth> {
  // Preferimos base64: pegar el JSON crudo en una variable de entorno se rompe
  // con facilidad (las comillas se pierden según la shell que lo escriba).
  if (config.googleServiceAccountB64) {
    const json = Buffer.from(config.googleServiceAccountB64, 'base64').toString('utf-8');
    return new gauth.GoogleAuth({ credentials: JSON.parse(json), scopes: SCOPES });
  }
  if (config.googleServiceAccountJson) {
    const credentials = JSON.parse(config.googleServiceAccountJson);
    return new gauth.GoogleAuth({ credentials, scopes: SCOPES });
  }
  if (config.googleKeyFile) {
    return new gauth.GoogleAuth({ keyFile: config.googleKeyFile, scopes: SCOPES });
  }
  throw new Error(
    'Falta la credencial de Google: define GOOGLE_SERVICE_ACCOUNT_B64 (el .json en base64), GOOGLE_SERVICE_ACCOUNT_JSON o GOOGLE_KEY_FILE'
  );
}

export function getSheets(): sheets_v4.Sheets {
  if (!client) {
    client = sheets({ version: 'v4', auth: getAuth() });
    log('SheetsClient', 'Cliente de Google Sheets inicializado');
  }
  return client;
}

export function isConfigured(): boolean {
  return Boolean(
    (config.googleServiceAccountB64 || config.googleServiceAccountJson || config.googleKeyFile) &&
    config.masterSheetId
  );
}

export async function readRange(range: string): Promise<string[][]> {
  const r = await getSheets().spreadsheets.values.get({
    spreadsheetId: config.masterSheetId,
    range,
    // Queremos el texto tal y como se ve, para no pelearnos con el formato de
    // fecha ni con la coma decimal española.
    valueRenderOption: 'FORMATTED_VALUE',
  });
  return (r.data.values ?? []) as string[][];
}

export async function writeCell(range: string, value: string): Promise<void> {
  await getSheets().spreadsheets.values.update({
    spreadsheetId: config.masterSheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[value]] },
  });
  log('SheetsClient', `Escrito ${range} = ${value}`);
}

// Escritura en bloque: una sola llamada para muchas celdas sueltas. Aplicar
// 40 cambios con writeCell() sería 40 llamadas y la hoja tarda lo suyo.
export async function writeCells(updates: Array<{ range: string; value: string }>): Promise<void> {
  if (!updates.length) return;
  await getSheets().spreadsheets.values.batchUpdate({
    spreadsheetId: config.masterSheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: updates.map(u => ({ range: u.range, values: [[u.value]] })),
    },
  });
  log('SheetsClient', `Escritas ${updates.length} celdas`);
}
