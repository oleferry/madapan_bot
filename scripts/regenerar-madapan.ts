// Regenera los pedidos de Madapan (mostrador) en Holded a partir de la hoja
// Pedidos_semana.
//
// Ojo con el desfase: la celda de la hoja del día X manda sobre la producción
// del día X-1. Verificado 8/8 contra los albaranes del 23 al 30 de agosto.
// Por eso el pedido del día D se rellena con la celda del día D+1.
//
// Uso:  npx ts-node scripts/regenerar-madapan.ts 2026-09-03 2026-09-06
import * as ps from '../src/services/pedidosSemanaService';
import * as holded from '../src/services/holdedClient';

// El contacto y el IVA por SKU no vienen en el listado normalizado de pedidos,
// solo en el documento crudo de Holded. Se resuelven una vez a partir de
// cualquier pedido de Madapan que siga vivo.
async function ficha(): Promise<{ contactId: string; iva: Map<string, number> }> {
  const cli = holded.getInvoicingV1Client();
  const docs = await cli.get<any[]>('/documents/salesorder');
  const suyo = (docs.data ?? []).find(d => String(d.contactName ?? '').toLowerCase().includes('madapan'));
  if (!suyo) throw new Error('no se encontró ningún pedido de Madapan del que sacar el contacto');
  const full = await cli.get<any>(`/documents/salesorder/${suyo.id}`);
  const iva = new Map<string, number>();
  for (const l of full.data?.products ?? []) if (l.sku) iva.set(l.sku, Number(l.tax ?? 4));
  return { contactId: String(full.data?.contact ?? suyo.contact), iva };
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

async function main(): Promise<void> {
  const [desde, hasta] = process.argv.slice(2);
  if (!desde || !hasta) throw new Error('uso: regenerar-madapan.ts <desde> <hasta>');

  const { contactId, iva } = await ficha();
  const filas = (await ps.leer()).filter(f => f.punto === 'Madapan');
  const skus = await ps.skusPorProducto();

  const fechas: string[] = [];
  for (let d = new Date(`${desde}T12:00:00Z`); d <= new Date(`${hasta}T12:00:00Z`);
       d.setUTCDate(d.getUTCDate() + 1)) {
    fechas.push(d.toISOString().slice(0, 10));
  }

  for (const fecha of fechas) {
    const dow = new Date(`${fecha}T12:00:00Z`).getUTCDay();
    const celda = DIAS[(dow + 1) % 7]!;            // la celda del día siguiente

    const previos = (await holded.listAllOrdersForDate(fecha))
      .filter(o => (o.contactName ?? '').toLowerCase().includes('madapan'));

    const lines = filas
      .filter(f => ps.esMismoDia(f.dia, celda) && f.cantidad > 0)
      .map(f => {
        const sku = skus.get(ps.normalizar(f.producto));
        if (!sku) { console.log(`   ⚠ sin SKU: ${f.producto}`); return null; }
        return { sku, name: f.producto, units: f.cantidad, price: 0, discount: 0,
                 taxPct: iva.get(sku) ?? 4 };
      })
      .filter((l): l is NonNullable<typeof l> => l !== null);

    if (!lines.length) { console.log(`${fecha}: nada que producir, lo salto`); continue; }

    for (const o of previos) {
      const r = await holded.deleteSalesOrder(o.id);
      if (!r.ok) { console.log(`${fecha}: NO se pudo borrar ${o.id}: ${r.error}`); return; }
    }

    const r = await holded.createSalesOrder(contactId, fecha, lines);
    console.log(`${fecha} (celda ${celda}): ${r.ok ? `✅ nº ${r.docNumber ?? '?'}` : `❌ ${r.error}`}` +
      `  ${lines.map(l => `${l.units} ${l.name}`).join(', ')}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
