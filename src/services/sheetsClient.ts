import { sheets, sheets_v4, auth as gauth } from '@googleapis/sheets';
import { config } from '../config';
import { log } from '../utils/logger';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

let client: sheets_v4.Sheets | null = null;

// La credencial puede venir de dos sitios: el JSON entero en una variable de
// entorno (Railway, donde no podemos dejar ficheros) o un fichero local.
function getAuth(): InstanceType<typeof gauth.GoogleAuth> {
  if (config.googleServiceAccountJson) {
    const credentials = JSON.parse(config.googleServiceAccountJson);
    return new gauth.GoogleAuth({ credentials, scopes: SCOPES });
  }
  if (config.googleKeyFile) {
    return new gauth.GoogleAuth({ keyFile: config.googleKeyFile, scopes: SCOPES });
  }
  throw new Error(
    'Falta la credencial de Google: define GOOGLE_SERVICE_ACCOUNT_JSON (contenido del .json) o GOOGLE_KEY_FILE (ruta al fichero)'
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
    (config.googleServiceAccountJson || config.googleKeyFile) && config.masterSheetId
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
