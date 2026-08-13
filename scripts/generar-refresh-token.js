/**
 * Genera el refresh token de Google Drive. Se ejecuta UNA SOLA VEZ, en local:
 *
 *     node scripts/generar-refresh-token.js
 *
 * Abre el navegador para que autorices con la cuenta dueña de la carpeta de
 * facturas en Drive, recoge el código en un servidor local y te imprime el
 * refresh token para pegarlo en .env (GOOGLE_OAUTH_REFRESH_TOKEN).
 *
 * No sirve ejecutarlo en Railway: necesita navegador. Por eso el token se
 * genera aquí y luego se sube como variable de entorno.
 */
require('dotenv').config();
const http = require('http');
const { OAuth2Client } = require('google-auth-library');

const PUERTO = 53682;
const REDIRECT = `http://localhost:${PUERTO}`;
const SCOPES = ['https://www.googleapis.com/auth/drive'];

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('Faltan GOOGLE_OAUTH_CLIENT_ID o GOOGLE_OAUTH_CLIENT_SECRET en .env');
  process.exit(1);
}

const cliente = new OAuth2Client(clientId, clientSecret, REDIRECT);

const url = cliente.generateAuthUrl({
  access_type: 'offline',
  // prompt=consent fuerza que Google devuelva refresh_token. Sin esto, si ya
  // autorizaste antes, solo devuelve el access token y el script no sirve.
  prompt: 'consent',
  scope: SCOPES,
});

const servidor = http.createServer(async (req, res) => {
  const params = new URL(req.url, REDIRECT).searchParams;
  const code = params.get('code');
  const error = params.get('error');

  if (error) {
    res.end(`Autorizacion cancelada: ${error}. Puedes cerrar esta pestana.`);
    console.error(`\nAutorizacion cancelada: ${error}`);
    servidor.close();
    process.exit(1);
  }
  if (!code) { res.end('Esperando el codigo de autorizacion...'); return; }

  try {
    const { tokens } = await cliente.getToken(code);
    res.end('Listo. Ya puedes cerrar esta pestana y volver a la terminal.');
    servidor.close();

    if (!tokens.refresh_token) {
      console.error('\nGoogle no ha devuelto refresh token.');
      console.error('Suele pasar si la app ya estaba autorizada. Revoca el acceso en');
      console.error('https://myaccount.google.com/permissions y vuelve a ejecutarlo.');
      process.exit(1);
    }

    console.log('\n' + '='.repeat(66));
    console.log('Pega esta linea en .env (sustituyendo la que esta vacia):\n');
    console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log('='.repeat(66));
    console.log('\nNo lo pegues en ningun chat ni lo subas al repositorio.');
    process.exit(0);
  } catch (err) {
    console.error('\nError al canjear el codigo:', err.message);
    servidor.close();
    process.exit(1);
  }
});

servidor.listen(PUERTO, () => {
  console.log('\nAbre esta URL en el navegador y autoriza con la cuenta');
  console.log('DUENA de la carpeta de facturas en Drive:\n');
  console.log(url);
  console.log('\nVeras el aviso "Google no ha verificado esta app":');
  console.log('  Configuracion avanzada  >  Ir a madapan-bot (no seguro)');
  console.log('\nEsperando autorizacion...');
});
