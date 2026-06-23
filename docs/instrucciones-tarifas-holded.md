# Instrucciones: Crear tarifas en Holded y asignarlas a clientes

## Contexto

Madapan tiene 3 tarifas de precios diferenciadas para sus clientes B2B.
Los descuentos ya han sido asignados automáticamente vía API.
Esta tarea consiste en crear las 3 listas de precios en Holded y asignarlas a cada cliente.

---

## PASO 1 — Crear las 3 tarifas en Holded

**Ruta en Holded:** Ventas → Configuración → Tarifas → Nueva tarifa

Crear estas 3 tarifas con los siguientes nombres exactos:

- `Tarifa 2025`
- `Tarifa 2026`
- `Tarifa Jose Villalón`

---

## PASO 2 — Añadir productos a cada tarifa

Para cada tarifa, añadir todos los productos con el precio indicado (precio sin IVA).

### Tarifa 2025

| Producto | SKU | Precio sin IVA (€) | IVA |
|----------|-----|-------------------|-----|
| Pan de cuadros | SKU63 | 1,82692 | 4% |
| Barra | SKU06 | 1,25000 | 4% |
| Chapata | SKU29 | 1,34615 | 4% |
| Hogaza | SKU48 | 2,40385 | 4% |
| Hogaza MM centeno | SKU47 | 3,36538 | 4% |
| Hogaza MM semillas | SKU70 | 3,36538 | 4% |
| Barra pequeña | SKU05 | 0,96154 | 4% |
| Pan pequeño | SKU69 | 1,15385 | 4% |
| Torta de aceite | SKU93 | 2,40385 | 4% |
| Torta de azúcar | SKU192 | 2,27273 | 10% |
| Caja magdalenas 1/2kg | SKU24 | 5,40909 | 10% |
| Rosquillas | SKU83 | 11,77273 | 10% |
| Bizcocho normal | SKU08 | 3,59091 | 10% |
| Bizcocho de nueces | SKU10 | 5,67308 | 4% |
| Bizcocho chocolate | SKU09 | 5,36364 | 10% |
| Pan integral | SKU113 | 2,40385 | 4% |
| Pan de canteros | SKU4321 | 1,82692 | 4% |
| Pan pasas y nueces | SKU641 | 3,75000 | 4% |
| Pastas de Lola | SKU170 | 3,36538 | 4% |
| Barra de picos | SKU562 | 1,25000 | 4% |

---

### Tarifa 2026

| Producto | SKU | Precio sin IVA (€) | IVA |
|----------|-----|-------------------|-----|
| Pan de cuadros | SKU63 | 1,87500 | 4% |
| Barra | SKU06 | 1,34620 | 4% |
| Chapata | SKU29 | 1,44230 | 4% |
| Hogaza | SKU48 | 2,40385 | 4% |
| Hogaza MM centeno | SKU47 | 3,46150 | 4% |
| Hogaza MM semillas | SKU70 | 3,36538 | 4% |
| Barra pequeña | SKU05 | 1,05770 | 4% |
| Pan pequeño | SKU69 | 1,25000 | 4% |
| Torta de aceite | SKU93 | 2,40385 | 4% |
| Torta de azúcar | SKU192 | 2,27273 | 10% |
| Caja magdalenas 1/2kg | SKU24 | 5,40909 | 10% |
| Rosquillas | SKU83 | 11,77273 | 10% |
| Bizcocho normal | SKU08 | 4,45460 | 10% |
| Bizcocho de nueces | SKU10 | 5,67308 | 4% |
| Bizcocho chocolate | SKU09 | 5,36364 | 10% |
| Pan integral | SKU113 | 2,50000 | 4% |
| Pan de canteros | SKU4321 | 1,87500 | 4% |
| Pan pasas y nueces | SKU641 | 3,75000 | 4% |
| Pastas de Lola | SKU170 | 6,77890 | 4% |
| Barra de picos | SKU562 | 1,25000 | 4% |

---

### Tarifa Jose Villalón

| Producto | SKU | Precio sin IVA (€) | IVA |
|----------|-----|-------------------|-----|
| Pan de cuadros | SKU63 | 1,73077 | 4% |
| Barra | SKU06 | 1,25000 | 4% |
| Chapata | SKU29 | 1,34615 | 4% |
| Hogaza | SKU48 | 2,40385 | 4% |
| Hogaza MM centeno | SKU47 | 3,36538 | 4% |
| Hogaza MM semillas | SKU70 | 3,36538 | 4% |
| Barra pequeña | SKU05 | 0,96154 | 4% |
| Pan pequeño | SKU69 | 1,15385 | 4% |
| Torta de aceite | SKU93 | 2,40385 | 4% |
| Torta de azúcar | SKU192 | 2,27273 | 10% |
| Caja magdalenas 1/2kg | SKU24 | 5,40909 | 10% |
| Rosquillas | SKU83 | 11,77273 | 10% |
| Bizcocho normal | SKU08 | 3,59091 | 10% |
| Bizcocho de nueces | SKU10 | 5,67308 | 4% |
| Bizcocho chocolate | SKU09 | 5,36364 | 10% |
| Pan integral | SKU113 | 2,40385 | 4% |
| Pan de canteros | SKU4321 | 1,82692 | 4% |
| Pan pasas y nueces | SKU641 | 3,75000 | 4% |
| Pastas de Lola | SKU170 | 3,36538 | 4% |
| Barra de picos | SKU562 | 1,25000 | 4% |

---

## PASO 3 — Asignar tarifa a cada cliente

**Ruta en Holded:** Contactos → buscar cliente → Editar → campo "Tarifa"

### Tarifa 2025 (la mayoría de clientes)

| Cliente | NIF |
|---------|-----|
| Madapan | B70954391 |
| Museo del Pan | A47535414 |
| Bar La Panera | 12369204B |
| Bar Queens Monasterio de Vega | Y8506669H |
| Bar de Ceinos | Z1824451G |
| Tienda de Cuenca | 44133376X |
| Ria de Vigo CB | E49105943 |
| Centro Hospital San Lázaro | V47018197 |
| Restaurante El Arco | 71005772B |
| Gasolinera La Mudarra | A47075882 |
| Ratón Repostero | 60852023A |
| Sonata Gastronómica | 12382442R |
| Horno Sanabres | B47384086 |
| La Huerta de Lucía | X8104227Q |
| Yolexis del Carmen | Z3651570A |
| Daniel Paniagua (pruebas) | 44915579Y |

### Tarifa 2026

| Cliente | NIF |
|---------|-----|
| Bar Villagómez | 20047141D |
| Bar Villacarralón | 44919597E |
| Teleclub Berrueces | 00000000A |
| Gasolinera La Mudarra | A47075882 |
| Kiosko Dulce Ilusión | 72919016T |
| Herbolario Medina de Rioseco | 12439477L |
| Kiosko Calle Hípica | 60673257Q |
| Valdenebro | 12382742W |

### Tarifa Jose Villalón

| Cliente | NIF |
|---------|-----|
| Villa de Celes | 44909283N |

---

## Notas

- Los descuentos (0%, 20%, 25%) ya están asignados automáticamente en Holded.
- La tarifa define el precio base; el descuento se aplica encima del precio de tarifa.
- El bot de Telegram también usa estas mismas tarifas internamente desde su catálogo local, por lo que no es necesario que el bot consulte Holded para los precios.
- Los productos SKU4321 (Pan de canteros) y SKU641 (Pan pasas y nueces) y SKU170 (Pastas de Lola) y SKU562 (Barra de picos) pueden no estar creados aún en Holded — verificar antes de añadirlos a la tarifa.
