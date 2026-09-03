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

describe('el albarán lleva la fecha real del reparto', () => {
  // Lo que va corrido un día es la HOJA, no el albarán: la celda "sábado"
  // contiene el pan que se hornea el viernes. Comprobado 8 días de 8.
  //
  // Antes se creía lo contrario y se leía el albarán del día anterior, así que
  // el pan de cada día se comparaba con las ventas del día de antes.
  const entregas: Entrega[] = [
    // Viernes 28: se reparten 70.
    { fecha: '2026-08-28', contactId: 'c1', cliente: 'El Arco',
      lineas: [{ sku: 'SKU63', name: 'Pan de cuadros', units: 70 }] },
    // Sábado 29: se reparten 65, y vuelven 12 del viernes.
    { fecha: '2026-08-29', contactId: 'c1', cliente: 'El Arco',
      lineas: [
        { sku: 'SKU63', name: 'Pan de cuadros', units: 65 },
        { sku: 'SKU63', name: 'Pan de cuadros', units: -12 },
      ] },
    // Domingo 30: se reparten 40, y vuelven 5 del sábado.
    { fecha: '2026-08-30', contactId: 'c1', cliente: 'El Arco',
      lineas: [
        { sku: 'SKU63', name: 'Pan de cuadros', units: 40 },
        { sku: 'SKU63', name: 'Pan de cuadros', units: -5 },
      ] },
  ];

  it('lo servido el sábado sale del albarán del sábado', () => {
    // dow 6 = sábado. Referencia: lunes 31, así que el sábado es el 29.
    const v = ventaSemanaAnterior(entregas, 'El Arco', 6, '2026-08-31')[0]!;
    expect(v.fecha).toBe('2026-08-29');
    expect(v.servido).toBe(65);
    // Las sobras del sábado se recogen el domingo: van en el albarán del 30.
    expect(v.devuelto).toBe(5);
    expect(v.venta).toBe(60);
    expect(v.sugerido).toBe(66);   // 60 × 1,10
  });

  it('con la regla vieja el sábado habría salido con los números del viernes', () => {
    // Este es el fallo que se arregló: leer el albarán del día anterior daba
    // 70 servidas y 12 devueltas, que es el reparto del VIERNES.
    const v = ventaSemanaAnterior(entregas, 'El Arco', 6, '2026-08-31')[0]!;
    expect(v.servido).not.toBe(70);
    expect(v.devuelto).not.toBe(12);
  });

  it('cada día se compara consigo mismo, no con el anterior', () => {
    const viernes = ventaSemanaAnterior(entregas, 'El Arco', 5, '2026-08-31')[0]!;
    expect(viernes.fecha).toBe('2026-08-28');
    expect(viernes.servido).toBe(70);
    expect(viernes.devuelto).toBe(12);   // vuelven en el albarán del sábado
    expect(viernes.venta).toBe(58);
    expect(viernes.sugerido).toBe(64);   // 58 × 1,10 = 63,8
  });

  it('sin el albarán del día siguiente no se sabe qué volvió', () => {
    // El domingo 30 es el último albarán: nadie ha recogido aún sus sobras.
    const domingo = ventaSemanaAnterior(entregas, 'El Arco', 0, '2026-08-31')[0]!;
    expect(domingo.servido).toBe(40);
    expect(domingo.hayDatoDevolucion).toBe(false);
  });
});
