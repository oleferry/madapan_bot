# Encargos sueltos (clientes no habituales)

**Fase 1 implementada.** `src/services/encargosService.ts` (almacén),
`src/bot/encargoFlow.ts` (alta desde Telegram) y la suma a `/produccion`.

## Cómo se usa hoy

- `/encargo` — alta guiada, solo staff: día → cliente → producto → cantidad →
  indicación para el obrador → más productos o terminar → nota de recogida →
  confirmar.
- `/encargos [YYYY-MM-DD]` — los encargos de un día, con botón para cancelar
  cada uno. Sin fecha, los de hoy.
- Los encargos aparecen automáticamente en `/produccion` del día, debajo de los
  pedidos de Holded, con los totales por producto.

El cliente se elige de la lista de habituales (los que más han encargado
primero) o se da de alta con el móvil. Si el móvil ya existe, el bot lo
reconoce y no duplica el cliente aunque esta vez lo llamen de otra forma.

## El problema real que sustituye

Hoy los encargos viven en un grupo de WhatsApp, agrupados por día y escritos a
mano. Ejemplo real (14-16 agosto 2026):

```
Viernes 14 agosto
- Carlos Magdaleno padre:
  2 empanadas redondas de atún y pisto. Lo recogerá junto a las pizzas a las 21:00.
  3 panes de cuadros.
- sara: 1 pan de cuadros pequeño
- jesus Banesto: 3 panes cuadros
* Paz Valencia: 1 empanada de bonito y 2 panes de cuadros grandes
* Mavi pan de pasas y nueces

Sábado 15 agosto
- Agapito: 25 barras grandes
- Jonathan: asado (tlf: 667621284)
- Zamora: 6 panes de cuadros pocos hechos
...
```

De ahí salen los requisitos de verdad, que no son obvios desde cero:

- **Clientes recurrentes.** Carlos Magdaleno padre, Agapito, Zamora, Jesús
  Banesto y Paz Valencia repiten en varios días de la misma semana. El cliente
  se da de alta una vez (nombre + móvil) y se reutiliza.
- **Nombres informales y ambiguos.** "Carlos Magdaleno padre" y "Carlos
  Magdaleno hijo" son dos clientes distintos. "Zamora", "Mavi" o "Agapito" son
  identificadores de barrio, no nombres fiscales. El móvil es la clave real.
- **Notas de preparación que persisten.** Zamora pide siempre "panes de cuadros
  pocos hechos". Eso tiene que llegar al obrador, no perderse.
- **Notas de recogida.** "Lo recogerá junto a las pizzas a las 21:00": el
  encargo se cruza con el flujo de pizzas ya existente.
- **Teléfono solo cuando importa.** En el grupo solo aparece para los asados
  (Jonathan, Antonio Baeza). Al darlo de alta en el bot lo pediremos siempre,
  porque es la clave del cliente recurrente.
- **Productos que no están en el catálogo.** Ver más abajo.

## Menú por categorías

El cliente elige primero categoría y luego producto, para no enfrentarse a
una lista de 20 cosas.

- **Pan** — Barra, Barra pequeña, Chapata, Pan de cuadros, Pan pequeño,
  Hogaza, Hogaza MM centeno, Hogaza MM semillas, Pan integral,
  Pan de canteros, Pan pasas y nueces, Barra de picos
- **Dulces** — Caja de magdalenas 1/2kg, Pastas de Lola, Rosquillas,
  Torta de aceite, Torta de azúcar, Bizcocho normal, Bizcocho de nueces,
  Bizcocho de chocolate
- **Repostería** — Donuts *(falta crear)*, Pain au chocolat, Panettone,
  Tarta de limón *(falta crear)*
- **Empanadas** *(todas faltan por crear)* — redonda de atún y pisto,
  de bonito, de bacon queso y pimientos, de cecina
- **Asados** *(falta crear)* — aparecen en el grupo sin más detalle

## ⚠️ Productos que no existen todavía

`data/catalog.json` tiene 20 productos y **no incluye empanadas, donuts,
asados ni tarta de limón**. Antes de implementar hay que:

1. Crearlos en Holded (para que tengan SKU y `holdedId`)
2. Añadirlos a `catalog.json` con sus precios
3. Decidir los tipos de empanada y su precio

**Importante:** todo producto nuevo que se cree en Holded nace **sin tarifas
asignadas** y cae al precio base. Ver `docs/` sobre tarifas: Holded ignora el
precio que envía el bot y lo resuelve por la tarifa del contacto. Hay que
añadir cada producto nuevo a las tres tarifas (2025, 2026, Jose Villalón).

También hay variantes de tamaño que el catálogo no distingue: "pan de cuadros
pequeño" y "pan de cuadros grande" aparecen como productos separados en el
grupo, y "barras grandes" frente a barra normal.

## Fases (en este orden)

1. ✅ **Encargo → resumen de producción.** Se guarda en el bot y aparece en
   `/produccion` junto a los pedidos de Holded. Sin tocar Holded. Es lo que
   de verdad hace falta a las 4:00 y lo más sencillo de las tres.
2. **Revisión en barra.** Un admin ve los encargos del día y confirma o
   cancela.
3. **Creación en Holded** del contacto y el pedido.
4. **Cobro en TPV.** Sin verificar: no se sabe si la API de Holded permite
   enlazar un pedido con un ticket de caja. Investigar antes de prometerlo.

## Decisiones pendientes

- Antelación mínima para encargar (equivalente a las 22:00 del pan).
  Probablemente distinta por categoría: una empanada no se prepara igual
  de rápido que una barra.
- ¿Precio de venta al público, distinto de las tarifas B2B?
- ¿Límite de unidades por encargo?
- ¿Quién puede dar de alta un encargo: solo staff, o el cliente final desde
  el bot? El grupo de WhatsApp lo lleva el staff hoy.

## Notas de implementación

- `buildProductionSummary()` (en `productionSummary.ts`) hoy solo lee
  pedidos de Holded. Para la fase 1 hay que sumarle los encargos guardados
  localmente.
- El almacenamiento debe ir en `DATA_DIR` (volumen de Railway), como
  `pizza-orders.log`, o se pierde en cada redespliegue. **Ojo:** en cada
  arranque aparece `[ClientCache] Created new clients cache file`, señal de
  que algo no está persistiendo bien en el volumen. Resolver eso ANTES de
  guardar encargos ahí.
- El flujo de pizzas ya valida teléfono o email (`pizzaFlow.ts`): reutilizar
  `esTelefonoValido`, que aquí el móvil es la clave del cliente recurrente.
