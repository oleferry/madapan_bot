# Facturas y albaranes de proveedor desde el bot

Flujo implementado: **foto → PDF → datos leídos → renombrado → carpeta del mes
en Drive → buzón de Holded**. Solo staff (`ADMIN_TELEGRAM_IDS`): son documentos
contables.

## Cómo se usa

1. Un admin manda al bot la **foto** de la factura. Si tiene varias hojas, las
   manda todas seguidas (hasta 8) y el bot las junta en un solo PDF.
2. Pulsa **Procesar**. El bot lee el documento con Claude y responde con
   proveedor, número, fecha, total, nº de líneas y el nombre con el que lo va a
   archivar.
3. Pulsa **Archivar y enviar**: sube el PDF a Drive y lo manda a Holded.

También acepta un **PDF** directamente (facturas que ya llegan digitales): en ese
caso se procesa sin montar nada.

Los **albaranes de compra** van por el mismo camino. El bot distingue solo si es
factura o albarán y archiva cada cosa en su carpeta
(`DRIVE_ALBARANES_FOLDER_ID`; si está vacía, van con las facturas). El albarán
**no** se manda a Holded: allí entra la factura, que es el documento contable.
El albarán se guarda para poder cotejar después lo albaranado con lo facturado.

## Nombre del archivo

`Proveedor nº-documento fecha.pdf` — por ejemplo
`DonDomino DD2026-5450 2026-01-10.pdf`.

Para el nombre se usa la **marca**, no el nombre fiscal: el histórico del Drive
está archivado como "DonDomino", "Makro" o "La Ventosa", y es como se busca. El
nombre fiscal (`Soluciones Corporativas IP, S.L.`, `Hijos de Valentín Gangoso,
S.A.`) se conserva en los datos extraídos, que es donde hace falta para cotejar
precios. Los caracteres que Drive o Windows no admiten (`/ : * ? " < > |`) se
sustituyen por guiones.

## Dónde se archiva

En la carpeta del **mes de la factura**, no el de hoy: una factura del 31 de
julio que llega en papel en agosto va a julio.

Se respeta la nomenclatura que ya existe en el Drive: `<año>/<AAMM>`, es decir
`2026/2607`. No es la más legible, pero cambiarla partiría en dos el archivo.
Si el año o el mes no existen, se crean.

## Lo que se comprueba antes de archivar

De cada línea se verifica que **cantidad × precio = importe** (descuento de
línea incluido). Si alguna no cuadra, el bot lo dice y enseña las líneas
afectadas en vez de archivar en silencio un dato mal leído. Esta comprobación es
lo que separa una extracción buena de una simplemente plausible: en las pruebas
con un parser posicional, un "1" y un "7.05" se pegaban en "17.05" y el
resultado parecía correcto.

## Configuración

En `.env` (y en Railway):

| Variable | Para qué |
|---|---|
| `ANTHROPIC_API_KEY` | Leer la factura |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` / `_REFRESH_TOKEN` | Escribir en Drive |
| `DRIVE_FACTURAS_FOLDER_ID` | Carpeta `.../Facturas/Recibidas` |
| `DRIVE_ALBARANES_FOLDER_ID` | Opcional, carpeta de albaranes |
| `HOLDED_INBOX_EMAIL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Envío a Holded |

La carpeta se fija **por ID** porque en el Drive hay tres carpetas llamadas
"Recibidas" y buscarla por nombre acierta la que no es.

Drive va con **OAuth de usuario**, no con la cuenta de servicio de la hoja
maestra: una cuenta de servicio no tiene "Mi unidad" y no puede escribir en la
de una cuenta Gmail normal. Ver `docs/credenciales-facturas.md`.

## ⚠️ Pendiente: el envío a Holded

El código está, pero **las variables SMTP están vacías**, así que hoy el bot
archiva en Drive y avisa de que el envío a Holded está sin configurar. Hacen
falta:

- La dirección del buzón de recepción de documentos de Holded de Madapan
- Un buzón desde el que enviar (host, usuario y contraseña de aplicación)

Va por correo y no por API a propósito: crear documentos de compra por API solo
admite **un vencimiento**, y hay proveedores que facturan a varios. Entrando por
el buzón, Holded lo procesa como si lo hubiera escaneado él y los conserva.

## Estado de las pruebas

- Extracción probada de punta a punta contra facturas reales del archivo
  (DonDomino, Makro): proveedor, número, fecha, total y líneas correctos, 0
  descuadres.
- Acceso de escritura a la carpeta de Drive verificado (`canAddChildren: true`).
- **La subida en sí no se ha ejecutado todavía**: escribir en el Drive real es
  una acción que conviene hacer con la primera factura de verdad, no con una de
  prueba que luego habría que borrar a mano.
