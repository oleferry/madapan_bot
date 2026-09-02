import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'penas-'));
process.env['PENAS_PATH'] = path.join(tmp, 'penas.json');

import * as penas from '../src/services/penasService';

const linea = (producto: string, cantidad: number): penas.LineaPena => ({ producto, cantidad });

// Precios reales de Holded, con el IVA incluido.
const PRECIOS = new Map([
  ['barra', 1.40], ['pan de cuadros', 1.95], ['chapata', 1.50],
  ['asado', 30], ['pizza', 14.95], ['tarta de limon', 25], ['super cookie', 7.50],
]);

describe('pedidos de peñas', () => {
  beforeEach(() => {
    try { fs.unlinkSync(process.env['PENAS_PATH']!); } catch { /* no existía */ }
    penas._reset();
  });

  it('son cinco días de fiestas, dos de ellos sábados', () => {
    expect(penas.DIAS_FIESTAS).toHaveLength(5);
    expect(penas.DIAS_FIESTAS[0]!.fecha).toBe('2026-09-19');
    expect(penas.DIAS_FIESTAS[4]!.fecha).toBe('2026-09-30');
  });

  it('suma el pedido con los precios de Holded', () => {
    const dias = [{ fecha: '2026-09-19', lineas: [linea('Barra', 10), linea('Pizza', 2)] }];
    // 10 × 1,40 + 2 × 14,95 = 43,90
    expect(penas.calcularTotal(dias, PRECIOS).total).toBe(43.9);
  });

  it('avisa de lo que no ha podido valorar', () => {
    const dias = [{ fecha: '2026-09-19', lineas: [linea('Empanada de cecina', 2)] }];
    const { total, sinPrecio } = penas.calcularTotal(dias, PRECIOS);
    expect(total).toBe(0);
    expect(sinPrecio).toEqual(['Empanada de cecina']);
  });

  it('los umbrales son estrictos: 60 clavados no llegan', () => {
    expect(penas.regalosPara(60)).toEqual([]);
    expect(penas.regalosPara(60.01)).toEqual(['Super chapata']);
    expect(penas.regalosPara(120)).toEqual(['Super chapata']);
    expect(penas.regalosPara(120.01)).toEqual(['Super chapata', 'Brazo gitano']);
  });

  it('dice cuál es el siguiente regalo y cuándo ya no queda ninguno', () => {
    expect(penas.siguienteUmbral(30)!.desde).toBe(60);
    expect(penas.siguienteUmbral(80)!.desde).toBe(120);
    expect(penas.siguienteUmbral(200)).toBeNull();
  });

  it('el regalo se añade al día 30 y no cuenta para el total', () => {
    const p = penas.crear({
      pena: 'Los Tardones', telefono: '612345678', telegramId: '1', precios: PRECIOS,
      dias: [{ fecha: '2026-09-19', lineas: [linea('Asado', 3)] }],   // 90 €
    });
    expect(p.total).toBe(90);
    expect(p.regalos).toEqual(['Super chapata']);
    const dia30 = p.dias.find(d => d.fecha === penas.DIA_REGALO)!;
    expect(dia30.lineas.map(l => l.producto)).toEqual(['Super chapata']);
    // Y el regalo no infla el total ni desbloquea el siguiente umbral.
    expect(penas.calcularTotal(p.dias, PRECIOS).total).toBe(90);
  });

  it('pasando de 120 caen los dos regalos', () => {
    const p = penas.crear({
      pena: 'Peña Grande', telefono: '612345678', telegramId: '1', precios: PRECIOS,
      dias: [{ fecha: '2026-09-19', lineas: [linea('Asado', 5)] }],   // 150 €
    });
    expect(p.regalos).toEqual(['Super chapata', 'Brazo gitano']);
  });

  it('los totales del día suman lo de todas las peñas', () => {
    penas.crear({ pena: 'Peña A', telefono: '612345678', telegramId: '1', precios: PRECIOS,
      dias: [{ fecha: '2026-09-19', lineas: [linea('Barra', 10), linea('Asado', 2)] }] });
    penas.crear({ pena: 'Peña B', telefono: '622345678', telegramId: '2', precios: PRECIOS,
      dias: [{ fecha: '2026-09-19', lineas: [linea('Barra', 5)] }] });

    expect(penas.totalesDia('2026-09-19')).toEqual([
      { producto: 'Barra', cantidad: 15 },
      { producto: 'Asado', cantidad: 2 },
    ]);
  });

  it('numera los pedidos y sobrevive a un reinicio', () => {
    const a = penas.crear({ pena: 'Peña A', telefono: '612345678', telegramId: '1', precios: PRECIOS,
      dias: [{ fecha: '2026-09-19', lineas: [linea('Barra', 1)] }] });
    expect(a.numero).toBe('PÑ-0001');
    penas._reset();
    expect(penas.todos()).toHaveLength(1);
  });
});
