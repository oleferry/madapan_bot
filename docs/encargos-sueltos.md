# Encargos sueltos (clientes no habituales) — especificación

Pendiente de implementar. Reutiliza casi todo el patrón del flujo de pizzas
(`src/bot/pizzaFlow.ts` + `src/services/pizzaService.ts`): público, sin NIF,
nombre + teléfono, aviso al staff y resumen para admin.

## Menú por categorías

El cliente elige primero categoría y luego producto, para no enfrentarse a
una lista de 20 cosas.

- **Pan** — Barra, Barra pequeña, Chapata, Pan de cuadros, Pan pequeño,
  Hogaza, Hogaza MM centeno, Hogaza MM semillas, Pan integral,
  Pan de canteros, Pan pasas y nueces, Barra de picos
- **Dulces** — Caja de magdalenas 1/2kg, Pastas de Lola, Rosquillas,
  Torta de aceite, Torta de azúcar, Bizcocho normal, Bizcocho de nueces,
  Bizcocho de chocolate
- **Repostería** — Donuts *(falta crear)*, Pain au chocolat, Panettone
- **Empanadas** — *(faltan crear: definir los tipos)*

## ⚠️ Productos que no existen todavía

`data/catalog.json` tiene 20 productos y **no incluye ni donuts ni
empanadas**. Antes de implementar hay que:

1. Crearlos en Holded (para que tengan SKU y `holdedId`)
2. Añadirlos a `catalog.json` con sus precios
3. Decidir los tipos de empanada y su precio

Sin esto, esas dos categorías saldrían vacías.

## Fases (en este orden)

1. **Encargo → resumen de producción.** Se guarda en el bot y aparece en
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

## Notas de implementación

- `buildProductionSummary()` (en `productionSummary.ts`) hoy solo lee
  pedidos de Holded. Para la fase 1 hay que sumarle los encargos guardados
  localmente.
- El almacenamiento debe ir en `DATA_DIR` (volumen de Railway), como
  `pizza-orders.log`, o se pierde en cada redespliegue.
