import * as ps from '../src/services/pedidosSemanaService';
import { construirPlan, Operacion } from '../src/services/instruccionesService';

// Mismo formato que la hoja: una fila por día × punto × producto.
function filasDe(punto: string, producto: string, cantidad: number, desde: number): ps.FilaPedido[] {
  return ps.DIAS.map((dia, i) => ({ fila: desde + i, dia, punto, producto, cantidad }));
}

const FILAS: ps.FilaPedido[] = [
  ...filasDe('BAR VILLACARRALÓN (ABEL FERNÁNDEZ REDONDO)', 'Pan de cuadros', 5, 100),
  ...filasDe('BAR VILLACARRALÓN (ABEL FERNÁNDEZ REDONDO)', 'Barra', 12, 110),
  ...filasDe('BAR VILLACARRALÓN (ABEL FERNÁNDEZ REDONDO)', 'Chapata', 10, 120),
  ...filasDe('Villa de Celes - JOSÉ GONZÁLEZ PASCUAL', 'Pan de cuadros', 1, 130),
  ...filasDe('Huerta de la Villa Alimentación SLU', 'Barra', 3, 140),
  ...filasDe('BAR DE CEINOS - ADA SORHEGUI RODRÍGUEZ', 'Pan integral', 1, 150),
  ...filasDe('HERBOLARIO MEDINA DE RIOSECO (JAKELINE BEATRIZ PORTELLA ARAINGA)', 'Barra', 1, 160),
];

const op = (o: Partial<Operacion>): Operacion =>
  ({ punto: '', tipo: 'fijar', literal: 'test', ...o } as Operacion);

describe('emparejar nombres de la hoja', () => {
  it('un apodo corto encuentra el punto completo', () => {
    expect(ps.buscarPunto(FILAS, 'Villacarralón')).toEqual(['BAR VILLACARRALÓN (ABEL FERNÁNDEZ REDONDO)']);
    expect(ps.buscarPunto(FILAS, 'Ceinos')).toHaveLength(1);
  });

  it('"Herbolario Rioseco" encuentra al que lleva otras palabras en medio', () => {
    // En la hoja es "HERBOLARIO MEDINA DE RIOSECO (...)": no es un substring.
    expect(ps.buscarPunto(FILAS, 'Herbolario Rioseco')).toHaveLength(1);
  });

  it('no confunde Villacarralón con Villa de Celes ni con Huerta de la Villa', () => {
    // El fallo que más caro sale: cambiarle el pedido a otro cliente.
    expect(ps.buscarPunto(FILAS, 'Villacarralón')).toHaveLength(1);
    expect(ps.buscarPunto(FILAS, 'Villa de Celes')).toEqual(['Villa de Celes - JOSÉ GONZÁLEZ PASCUAL']);
  });

  it('el plural encuentra el producto en singular', () => {
    const ceinos = 'BAR DE CEINOS - ADA SORHEGUI RODRÍGUEZ';
    expect(ps.buscarProducto(FILAS, ceinos, 'panes integrales')).toEqual(['Pan integral']);
  });

  it('solo busca entre los productos que ese punto lleva', () => {
    const ceinos = 'BAR DE CEINOS - ADA SORHEGUI RODRÍGUEZ';
    expect(ps.buscarProducto(FILAS, ceinos, 'chapatas')).toEqual([]);
  });
});

describe('construir el plan de cambios', () => {
  it('fijar una cantidad toca los siete días', async () => {
    const plan = await construirPlan(
      [op({ punto: 'Villacarralón', tipo: 'fijar', producto: 'chapatas', cantidad: 12 })], FILAS);
    expect(plan.cambios).toHaveLength(7);
    expect(plan.cambios.every(c => c.nuevo === 12 && c.actual === 10)).toBe(true);
  });

  it('lo que ya estaba bien no se toca, pero se dice', async () => {
    const plan = await construirPlan(
      [op({ punto: 'Villacarralón', tipo: 'fijar', producto: 'barras', cantidad: 12 })], FILAS);
    expect(plan.cambios).toHaveLength(0);
    expect(plan.avisos.join(' ')).toContain('ya estaba en 12');
  });

  it('cerrar un día pone a cero todos sus productos', async () => {
    const plan = await construirPlan(
      [op({ punto: 'Villacarralón', tipo: 'cerrar', dias: ['lunes'] })], FILAS);
    expect(plan.cambios).toHaveLength(3);          // pan, barra, chapata
    expect(plan.cambios.every(c => c.nuevo === 0 && c.dia === 'lunes')).toBe(true);
  });

  it('cuando dos ordenes tocan la misma celda, manda la mas especifica', async () => {
    // "a 4 panes" + "no abren los lunes": el lunes tiene que quedar en 0.
    const plan = await construirPlan([
      op({ punto: 'Villacarralón', tipo: 'fijar', producto: 'panes', cantidad: 4 }),
      op({ punto: 'Villacarralón', tipo: 'cerrar', dias: ['lunes'] }),
    ], FILAS);
    const lunes = plan.cambios.filter(c => c.dia === 'lunes' && c.producto === 'Pan de cuadros');
    expect(lunes).toHaveLength(1);
    expect(lunes[0]!.nuevo).toBe(0);
  });

  it('un punto ambiguo no se toca: se pregunta', async () => {
    const plan = await construirPlan([op({ punto: 'Villa', tipo: 'cerrar' })], FILAS);
    expect(plan.cambios).toHaveLength(0);
    expect(plan.dudas.join(' ')).toContain('varios puntos');
  });

  it('un producto que no lleva ese punto no se inventa', async () => {
    const plan = await construirPlan(
      [op({ punto: 'Ceinos', tipo: 'fijar', producto: 'hogazas', cantidad: 3 })], FILAS);
    expect(plan.cambios).toHaveLength(0);
    expect(plan.dudas.join(' ')).toContain('no lleva nada que se parezca');
  });

  it('avisa de que un cambio temporal se queda puesto', async () => {
    const plan = await construirPlan(
      [op({ punto: 'Herbolario Rioseco', tipo: 'cerrar', temporal: true })], FILAS);
    expect(plan.cambios).toHaveLength(7);
    expect(plan.avisos.join(' ')).toContain('todas las semanas');
  });

  it('las celdas que se escriben son la columna D de cada fila', () => {
    const celdas = ps.aCeldas([
      { fila: 148, punto: 'x', dia: 'lunes', producto: 'y', actual: 5, nuevo: 4, motivo: '' },
    ]);
    expect(celdas).toEqual([{ range: 'Pedidos_semana!D148', value: '4' }]);
  });
});

describe('el mismo producto con dos nombres', () => {
  // SKU69 es "Pan pequeño" en la hoja y "Pan de cuadros pequeño" en los
  // albaranes de Holded. Comparando por nombre, todo lo servido bajo el otro
  // nombre se quedaba fuera del cálculo.
  const skus = new Map([['pan pequeno', 'SKU69'], ['barra', 'SKU06']]);

  it('empareja por SKU aunque el nombre no coincida', () => {
    expect(ps.mismoProducto('Pan pequeño', 'SKU69', 'Pan de cuadros pequeño', skus)).toBe(true);
  });

  it('no empareja dos productos distintos aunque se parezcan de nombre', () => {
    expect(ps.mismoProducto('Pan pequeño', 'SKU63', 'Pan de cuadros', skus)).toBe(false);
  });

  it('sin SKU conocido, cae al nombre', () => {
    expect(ps.mismoProducto('Chapata', '', 'Chapata')).toBe(true);
    expect(ps.mismoProducto('Chapata', '', 'Hogaza')).toBe(false);
  });
});
