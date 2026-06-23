# Madapan Bot v2

Bot de Telegram para la gestión de pedidos B2B de Madapan SL.

## 1. Qué hace el bot

Permite a los clientes B2B de Madapan consultar y modificar las cantidades de sus pedidos de venta existentes en Holded directamente desde Telegram. Los cambios se aplican en tiempo real mediante la API de Holded. Los pedidos deben existir previamente en Holded como Pedidos de Venta.

Flujo simplificado:
```
Cliente Telegram → Bot → API de Holded → modifica el pedido de venta
```

## 2. Cómo registrar clientes

El bot identifica a los clientes por su número de teléfono móvil:

1. Añadir el número de móvil del cliente en el contacto de Holded (campo **Móvil**).
2. El cliente inicia el bot con `/start`.
3. El bot pide compartir el teléfono (botón de Telegram).
4. El bot busca ese número en los contactos de Holded.
5. Si lo encuentra, guarda la asociación en `data/clients.json` y el cliente queda registrado.
6. Si no lo encuentra, responde: "No estás registrado en Madapan. Contacta con nosotros."

El fichero `data/clients.json` actúa como caché local. Para eliminar un cliente del bot basta con borrar su entrada de ese fichero.

## 3. Variables de entorno

Copia `.env.example` a `.env` y rellena los valores:

| Variable | Descripción |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Token del bot (de @BotFather) |
| `TELEGRAM_INTERNAL_CHAT_ID` | ID del chat interno para resúmenes diarios (opcional) |
| `HOLDED_API_KEY` | API Key de Holded |
| `HOLDED_API_BASE_URL` | Base URL API de pedidos (por defecto `https://api.holded.com/api/invoicing/v1`) |
| `HOLDED_CONTACTS_URL` | Base URL API de contactos (por defecto `https://api.holded.com/api/contacts/v1`) |
| `TIMEZONE` | Zona horaria (por defecto `Europe/Madrid`) |
| `AUTO_CHANGE_LIMIT_HOUR` | Hora de corte para umbrales estrictos (por defecto `20`) |
| `DAILY_SUMMARY_HOUR` | Hora del resumen diario (por defecto `0`) |
| `DRY_RUN` | Si es `true`, no se escriben cambios en Holded |
| `CLIENTS_CACHE_PATH` | Ruta del fichero de caché de clientes (por defecto `data/clients.json`) |
| `LOG_PATH` | Ruta del log de cambios (por defecto `logs/changes.log`) |

## 4. Modo DRY_RUN

Con `DRY_RUN=true` (activo por defecto en desarrollo) el bot:
- NO realiza ninguna escritura en Holded.
- Simula respuestas exitosas.
- Registra en consola qué habría hecho.
- Sigue escribiendo en `logs/changes.log` con `"dryRun": true`.

Para producción: `DRY_RUN=false`.

## 5. Cómo ejecutar

### Desarrollo

```bash
npm install
cp .env.example .env
# Rellenar .env
npm run dev
```

### Producción

```bash
npm install
npm run build
npm start
```

### Tests

```bash
npm test
```

## 6. Qué hace V2 y qué NO hace

### Hace:
- Identificar clientes por teléfono buscando en la API de contactos de Holded.
- Cachear la asociación telegram_id → holded_contact_id en local (JSON).
- Mostrar el pedido de venta de mañana u otro día.
- Modificar cantidades de líneas en pedidos de venta de Holded via botones (+1, -1, +2, -2, +5, -5, cantidad exacta).
- Interpretar mensajes de texto en español ("mañana +2 barras", "quita 1 chapata para el martes").
- Aplicar cambios que superen el umbral con aviso al cliente (sin bloquear).
- Registrar todos los cambios en `logs/changes.log` (JSON lines).
- Enviar resumen diario al chat interno de Telegram.

### NO hace:
- Crear nuevos pedidos (solo modifica los existentes).
- Usar Google Sheets.
- Flujo de aprobación interno (los cambios sobre umbral se aplican igualmente con aviso).
- Gestión de múltiples idiomas.
- Cancelar pedidos.
