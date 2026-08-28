/**
 * Asigna el IVA a los productos de Holded que no lo tienen.
 *
 *   npx ts-node scripts/asignar-iva.ts            → solo enseña lo que haría
 *   npx ts-node scripts/asignar-iva.ts --aplicar  → lo escribe en Holded
 *
 * El criterio NO se saca de la ley, sino de cómo está ya clasificado el propio
 * catálogo de Madapan, que es lo que mantiene la coherencia con lo ya emitido:
 *
 *   4 %  → pan y harinas (Barra, Panecillos, Pan de ajo, Pan duro, Harina,
 *          Torta de aceite, Pan brioche para hamburguesa)
 *   10 % → pastelería, salados y bebidas servidas (Croissant, Palmeritas,
 *          Rosquillas, Tarta Pavlova, Gofre, Café con leche, Cerveza, Vino)
 *   21 % → solo embalaje, que no es alimentación (bolsas, cajas, papel horno)
 *
 * Ojo con lo de las bebidas: cerveza y vino están al 10 % porque en hostelería
 * tributa el SERVICIO, no la bebida. No es un error del catálogo.
 */
import axios from 'axios';
import 'dotenv/config';

const key = process.env['HOLDED_API_KEY_V1'] || process.env['HOLDED_API_KEY'];
const APLICAR = process.argv.includes('--aplicar');

const A_4 = ['Barra bocadillo', 'Pan ración', 'Pan gigante', 'Saco pan duro pequeño',
  'Harina (bolsa 500g)', 'Torta de aceite pequeña'];

const A_10 = ['Asado', 'Buñuelos (1kg)', 'Buñuelos (500g)', 'Buñuelos (unidad) (35 g)',
  'Croissant Queso', 'Cucharetas 300 gramos', 'Galletas Feas 300 gramos',
  'Huesos de santo chocolate', 'Huesos de santo yema', 'Madapanitos Caja', 'Madapanitos bolsa',
  'Panettone chocolate', 'Panettone clásico', 'Pastas de avena (400g)', 'Pastas de colores de te',
  'Pastas de piñones 400 g', 'Roscón grande relleno', 'Roscón grande sin relleno',
  'Roscón mediano relleno', 'Roscón mediano sin relleno', 'Roscón porción', 'Roscón porción mini',
  'Roscón relleno porción', 'Tarta de San Marcos con chocolate', 'Tarta de hojaldre y crema',
  'Tarta de queso con frutos rojos', 'Tarta porción', 'Tartas variadas', 'Tiramisú',
  'Torrija crema', 'Torrija normal', 'Caracola de queso y aceitunas', 'Empanadilla', 'Panini',
  'Chocolate a la taza', 'Chocolate a la taza con nata', 'Chocolate máquina'];

// Estos NO se tocan: no tengo con qué decidirlos sin inventar.
//   Jurasienne  → si es pan, 4 %; si es bollería, 10 %
//   Mosto       → "Mosto" está al 4 % pero los refrescos al 10 %; incoherente
//   Vermú       → alcohol servido; por el criterio de la casa sería 10 %
//   Torta de coscorrón → si va con la torta de aceite, 4 %
const DUDOSOS = ['Jurasienne ud', 'Jurasienne bolsa 2', 'Mosto pequeño',
  'Vermú grande', 'Vermú pequeño', 'Torta de coscorrón'];

async function main(): Promise<void> {
  const url = 'https://api.holded.com/api/invoicing/v1/products';
  const productos = (await axios.get<any[]>(url, { headers: { key } })).data;

  let hechos = 0, fallos = 0, saltados = 0;

  for (const [lista, iva] of [[A_4, 's_iva_4'], [A_10, 's_iva_10']] as const) {
    for (const nombre of lista) {
      const x = productos.find(y => y.name === nombre);
      if (!x) { console.log(`⚠️  no existe: ${nombre}`); fallos++; continue; }
      if ((x.taxes ?? []).filter(Boolean).length) {
        console.log(`·   ya tenía IVA: ${nombre}`); saltados++; continue;
      }
      console.log(`${APLICAR ? '→' : ' '}   ${iva.replace('s_iva_', '')}%  ${nombre}  (${x.price} €)`);
      if (!APLICAR) continue;

      // El PUT exige el producto ENTERO: mandar solo "taxes" borra lo demás.
      try {
        await axios.put(`${url}/${x.id}`, {
          name: x.name, sku: x.sku, kind: x.kind, desc: x.desc, price: x.price,
          taxes: [iva], barcode: x.barcode, cost: x.cost, purchasePrice: x.purchasePrice,
          weight: x.weight, tags: x.tags, forSale: x.forSale, forPurchase: x.forPurchase,
        }, { headers: { key } });
        hechos++;
      } catch (e: any) {
        console.log(`❌  ${nombre}: ${e.response?.status ?? e.message}`);
        fallos++;
      }
    }
  }

  console.log(`\nSin decidir (revísalos a mano): ${DUDOSOS.join(', ')}`);
  console.log(APLICAR
    ? `\nAplicados: ${hechos} | ya tenían: ${saltados} | fallos: ${fallos}`
    : `\nEsto es solo una simulación. Para escribirlo: npx ts-node scripts/asignar-iva.ts --aplicar`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
