// Ajusta las cantidades de los puntos de reparto en la hoja Pedidos_semana a
// partir del histórico de albaranes de febrero a junio.
//
// Venta real de un día = lo que sale en su albarán menos las sobras, que se
// apuntan en negativo en el albarán del día siguiente.
//
// De lunes a jueves se estandariza a un solo valor: veinte semanas de datos
// dicen que esos cuatro días son planos, y a los despachos les cuesta seguir
// un pedido que cambia cada día. Viernes, sábado y domingo van con el suyo,
// porque el viernes se vende hasta el doble y aplanarlo deja al cliente sin
// pan justo el día fuerte.
//
// Se descartan Semana Santa, Carnaval y los festivos autonómicos: son semanas
// que no representan el consumo normal. Las fiestas locales de cada pueblo no
// hace falta enumerarlas, la mediana sobre ~20 semanas las absorbe.
//
// Uso:  npx ts-node scripts/ajustar-despachos.ts [--escribir]
import * as ps from '../src/services/pedidosSemanaService';
import * as aj from '../src/services/ajusteSemanalService';
import * as historico from '../src/services/historicoVentas';

const DESDE = '2026-02-01';
const HASTA = '2026-06-30';
const MARGEN = 1.10;
const MIN_MUESTRAS = 4;

const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

// Productos que no son pan ni derivados: son encargos sueltos, no consumo
// diario, y no tiene sentido ajustarlos por la venta de la semana.
const NO_PAN = ['coquito', 'saco pan duro', 'tarta', 'empanada', 'brazo', 'cookie', 'pastas'];

function excluido(fecha: string): boolean {
  return (fecha >= '2026-03-28' && fecha <= '2026-04-07')   // Semana Santa (Pascua 05/04)
    || fecha === '2026-04-23'                                // Día de Castilla y León
    || fecha === '2026-05-01'                                // Día del Trabajo
    || fecha === '2026-02-16' || fecha === '2026-02-17';     // Carnaval
}

function mediana(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

const lunesPrimero = (f: string): number => (new Date(`${f}T12:00:00Z`).getUTCDay() + 6) % 7;

function manana(f: string): string {
  const d = new Date(`${f}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const escribir = process.argv.includes('--escribir');
  const entregas = await historico.cargar();

  // muestras[cliente|producto][día] = ventas reales observadas
  const muestras = new Map<string, number[][]>();
  for (const alb of entregas) {
    if (alb.fecha < DESDE || alb.fecha > HASTA || excluido(alb.fecha)) continue;
    const sig = entregas.find(x => x.cliente === alb.cliente && x.fecha === manana(alb.fecha));
    for (const l of historico.servido(alb)) {
      const dev = sig
        ? historico.devuelto(sig).filter(x => x.sku === l.sku).reduce((t, x) => t + x.units, 0)
        : 0;
      const k = `${alb.cliente}|${ps.normalizar(l.name)}`;
      const a = muestras.get(k) ?? DIAS.map(() => [] as number[]);
      a[lunesPrimero(alb.fecha)]!.push(l.units - dev);
      muestras.set(k, a);
    }
  }

  const filas = await ps.leer();
  const { mapa, ambiguos } = aj.emparejarPuntos(
    [...new Set(filas.map(f => f.punto))],
    [...new Set(entregas.map(x => x.cliente))]
  );
  if (ambiguos.length) console.log(`⚠ sin emparejar: ${ambiguos.join(' | ')}`);

  const cambios: ps.Cambio[] = [];
  const lineas: string[] = [];

  for (const f of filas) {
    if (f.cantidad <= 0) continue;                    // ese día no se reparte
    if (aj.esFijo(f.punto)) continue;                 // pedido fijo, no se toca
    if (ps.normalizar(f.punto).includes('madapan')) continue;   // el mostrador va por tickets
    if (NO_PAN.some(x => ps.normalizar(f.producto).includes(x))) continue;

    const cliente = mapa.get(f.punto);
    if (!cliente) continue;
    const a = muestras.get(`${cliente}|${ps.normalizar(f.producto)}`);
    if (!a) continue;

    // La celda del día X manda sobre la producción del día X-1.
    const produce = (DIAS.findIndex(d => ps.esMismoDia(f.dia, d)) + 6) % 7;

    let base: number;
    if (produce <= 3) {
      // Con un solo día bueno no hay estándar que valga: puede ser un producto
      // que ese punto compra de higos a brevas.
      const buenos = a.slice(0, 4).filter(d => d.length >= MIN_MUESTRAS);
      if (buenos.length < 2) continue;
      base = mediana(buenos.map(mediana));
    } else {
      if (a[produce]!.length < MIN_MUESTRAS) continue;
      base = mediana(a[produce]!);
    }

    const nuevo = Math.max(1, Math.round(base * MARGEN));
    if (nuevo === f.cantidad) continue;
    cambios.push({
      fila: f.fila, punto: f.punto, producto: f.producto, dia: f.dia,
      actual: f.cantidad, nuevo,
      motivo: `${DIAS[produce]}: mediana ${base} feb-jun +${Math.round((MARGEN - 1) * 100)}%`,
    });
    lineas.push(`  ${f.punto.slice(0, 24).padEnd(26)}${f.producto.slice(0, 17).padEnd(18)}` +
      `${DIAS[produce]!.padEnd(10)}${String(f.cantidad).padStart(4)} → ${nuevo}`);
  }

  console.log(lineas.sort().join('\n'));
  console.log(`\n${cambios.length} celdas · ${cambios.reduce((t, c) => t + c.nuevo - c.actual, 0)} piezas`);

  if (!escribir) { console.log('\n(simulación: añade --escribir para aplicarlo)'); return; }
  await ps.aplicar(cambios);
  console.log(`✅ escrito en Pedidos_semana`);
}

main().catch(e => { console.error(e); process.exit(1); });
