# Credenciales del módulo de facturas de proveedor

Cómo se generaron y por qué son como son. **Aquí no hay ningún secreto**: los
valores viven en `.env` (ignorado por git) y en las variables de Railway.

## Google OAuth (Drive)

- Proyecto GCP: `madapanbot`
- Cliente: `madapan-bot-facturas` (aplicación de escritorio)
- Cuenta propietaria: la dueña de la carpeta de Drive
- APIs habilitadas: Google Drive API y Google Sheets API
- Público: Externo, estado **En producción**
- Scope: `https://www.googleapis.com/auth/drive`

Variables: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
`GOOGLE_OAUTH_REFRESH_TOKEN`.

### Por qué OAuth y no la cuenta de servicio

La cuenta de servicio `madapan-sheets@` **no puede escribir en "Mi unidad"** de
una cuenta Gmail normal: solo en Unidades compartidas, que aquí no existen.
Para archivar facturas hay que actuar como el propio usuario. La cuenta de
servicio sigue existiendo y se usa para las hojas de cálculo; no se ha tocado.

### Notas de la autorización

- Con la app publicada en producción, el refresh token **no caduca a los 7
  días**. Se mantiene salvo que se revoque el acceso, se cambie la contraseña,
  se modifiquen los scopes o pasen 6 meses sin usarlo.
- Al autorizar por primera vez aparece "Google no ha verificado esta app":
  hay que entrar en *Configuración avanzada* → *Ir a madapan-bot (no seguro)*.
  Es esperable.
- Google marca la app como "requiere verificación" por usar el scope
  restringido `/auth/drive`. Funciona sin verificar con un tope de 100
  usuarios; para un solo usuario no es problema.
- Si la verificación llegase a estorbar, la alternativa es cambiar a
  `drive.file` (solo los ficheros que crea el bot), que no es restringido y no
  exige verificación ni pantalla de aviso.

## Anthropic

Variable: `ANTHROPIC_API_KEY`. Se usa para leer facturas y albaranes, tanto de
texto como de foto.

**Pendiente: el límite de gasto.** No se pone por clave, va por Workspace. Hay
que crear un Workspace con límite mensual y mover la clave dentro. Sin eso, un
bucle en el bot puede gastar sin freno.
