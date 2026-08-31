import { ventaRealPorDia, ventaSemanaAnterior } from '../src/services/ajusteSemanalService';
import { Entrega } from '../src/services/historicoVentas';

// Lunes: se sirven 20 barras. Martes: albarán con la entrega del martes MÁS
// la devolución del lunes en negativo.
const semana = (lunes: string, servidoLunes: number, devueltoDelLunes: number): Entrega[] => {
  const martes = new Date(`${lunes}T12:00:00Z`);
  martes.setUTCDate(martes.getUTCDate() + 1);
  return [
    {
      fecha: lunes, contactId: 'c1', cliente: 'El Arco',
      lineas: [{ sku: 'SKU06', name: 'Barra', units: servidoLunes }],
    },
    {
      fecha: martes.toISOString().slice(0, 10), contactId: 'c1', cliente: 'El Arco',
      lineas: [
        { sku: 'SKU06', name: 'Barra', units: 10 },
        { sku: 'SKU06', name: 'Barra', units: -devueltoDelLunes },
      ],
    },
  ];
};

describe('venta real a partir de las devoluciones', () => {
  it('resta la devolución al día ANTERIOR, no al día en que aparece', () => {
    // 20 servidas el lunes, 6 devueltas el martes → el lunes vendió 14.
    const e = [...semana('2026-08-03', 20, 6), ...semana('2026-08-10', 20, 6), ...semana('2026-08-17', 20, 6)];
    const lunes = ventaRealPorDia(e, 'El Arco', 1)[0]!;
    expect(lunes.servidoMedio).toBe(20);
    expect(lunes.devueltoMedio).toBe(6);
    expect(lunes.ventaMedia).toBe(14);
    // 14 × 1,10 = 15,4 → 15. Se redondea al más cercano, no al alza: hacerlo
    // hacia arriba en cada celda convertía el colchón del 10 % en un 17 %.
    expect(lunes.sugerido).toBe(15);
  });

  it('el martes no carga con la devolución que le llega ese día', () => {
    const e = [...semana('2026-08-03', 20, 6), ...semana('2026-08-10', 20, 6)];
    const martes = ventaRealPorDia(e, 'El Arco', 2)[0]!;
    // Sirve 10 los martes; su devolución vendría en el albarán del miércoles,
    // que aquí no existe, así que no se le resta nada.
    expect(martes.servidoMedio).toBe(10);
    expect(martes.devueltoMedio).toBe(0);
  });

  it('sin devolución, el sugerido es el servido más el 10 %', () => {
    const e = [...semana('2026-08-03', 20, 0), ...semana('2026-08-10', 20, 0)];
    const lunes = ventaRealPorDia(e, 'El Arco', 1)[0]!;
    expect(lunes.ventaMedia).toBe(20);
    expect(lunes.sugerido).toBe(22);
  });

  it('una devolución de algo que no se sirvió ese día se ignora', () => {
    // Devuelven chapata el martes pero el lunes solo se sirvió barra: no puede
    // salir una venta negativa de la nada.
    const e: Entrega[] = [
      { fecha: '2026-08-03', contactId: 'c1', cliente: 'El Arco', lineas: [{ sku: 'SKU06', name: 'Barra', units: 10 }] },
      { fecha: '2026-08-04', contactId: 'c1', cliente: 'El Arco', lineas: [{ sku: 'SKU29', name: 'Chapata', units: -3 }] },
    ];
    const lunes = ventaRealPorDia(e, 'El Arco', 1);
    expect(lunes).toHaveLength(1);
    expect(lunes[0]!.ventaMedia).toBe(10);
  });

  it('la venta nunca baja de cero aunque se devuelva de más', () => {
    const e = semana('2026-08-03', 5, 12);
    const lunes = ventaRealPorDia(e, 'El Arco', 1)[0]!;
    expect(lunes.ventaMedia).toBe(0);
    expect(lunes.sugerido).toBe(0);
  });

  it('cuenta las semanas de las que hay dato', () => {
    const e = [...semana('2026-08-03', 20, 6), ...semana('2026-08-10', 20, 6)];
    expect(ventaRealPorDia(e, 'El Arco', 1)[0]!.semanas).toBe(2);
  });
});

describe('el albarán va fechado el día anterior a la entrega', () => {
  // Comprobado contra la hoja: el albarán del viernes 28/08 lleva 70 panes,
  // que es la cantidad del SÁBADO. Se genera de madrugada, antes de repartir.
  const entregas: Entrega[] = [
    // Albarán del viernes 28 → entrega del sábado 29: 70 piezas.
    { fecha: '2026-08-28', contactId: 'c1', cliente: 'El Arco',
      lineas: [{ sku: 'SKU63', name: 'Pan de cuadros', units: 70 }] },
    // Albarán del sábado 29 → entrega del domingo, y las sobras del sábado.
    { fecha: '2026-08-29', contactId: 'c1', cliente: 'El Arco',
      lineas: [
        { sku: 'SKU63', name: 'Pan de cuadros', units: 70 },
        { sku: 'SKU63', name: 'Pan de cuadros', units: -10 },
      ] },
  ];

  it('lo servido el sábado sale del albarán del viernes', () => {
    // dow 6 = sábado. Referencia: lunes 31, así que el sábado es el 29.
    const v = ventaSemanaAnterior(entregas, 'El Arco', 6, '2026-08-31')[0]!;
    expect(v.servido).toBe(70);
    // Y las sobras del sábado están en el albarán fechado el sábado.
    expect(v.devuelto).toBe(10);
    expect(v.venta).toBe(60);
    expect(v.sugerido).toBe(66);   // 60 × 1,10
  });

  it('no confunde el día de la entrega con la fecha del documento', () => {
    // Si se leyera el albarán del sábado como "lo servido el sábado", la
    // devolución de ese mismo día se restaría del día equivocado.
    const domingo = ventaSemanaAnterior(entregas, 'El Arco', 0, '2026-08-31');
    expect(domingo).toHaveLength(1);
    expect(domingo[0]!.servido).toBe(70);   // del albarán del sábado
  });
});
