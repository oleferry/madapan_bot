import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'penas-'));
process.env['PENAS_PATH'] = path.join(tmp, 'penas.json');

import * as penas from '../src/services/penasService';

const linea = (producto: string, cantidad: number): penas.LineaPena => ({ producto, cantidad });
const todosLosDias = () => penas.DIAS_FIESTAS.map(f => ({
  fecha: f.fecha, lineas: [linea('Barra', 10)],
}));

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

  it('pedir los cinco días da el regalo, y va en el día 30', () => {
    const p = penas.crear({ pena: 'Los Tardones', telefono: '612345678', telegramId: '1', dias: todosLosDias() });
    expect(p.completo).toBe(true);
    const ultimo = p.dias.find(d => d.fecha === penas.DIA_REGALO)!;
    expect(ultimo.lineas.filter(l => l.regalo).map(l => l.producto))
      .toEqual(['Super chapata', 'Super cookie']);
  });

  it('con cuatro días no hay regalo, por cerca que se quede', () => {
    const p = penas.crear({
      pena: 'Casi Casi', telefono: '612345678', telegramId: '2',
      dias: todosLosDias().slice(0, 4),
    });
    expect(p.completo).toBe(false);
    expect(p.dias.flatMap(d => d.lineas).some(l => l.regalo)).toBe(false);
  });

  it('un día apuntado pero vacío no cuenta como pedido', () => {
    const dias = todosLosDias();
    dias[2]!.lineas = [];
    expect(penas.esCompleto(dias)).toBe(false);
  });

  it('el regalo no cuenta para completar el pedido', () => {
    // Si el regalo valiera como línea del día 30, pedir cuatro días daría
    // el quinto por la cara.
    const dias = todosLosDias().slice(0, 4);
    dias.push({ fecha: penas.DIA_REGALO, lineas: [{ producto: 'Super cookie', cantidad: 1, regalo: true }] });
    expect(penas.esCompleto(dias)).toBe(false);
  });

  it('los totales del día suman lo de todas las peñas', () => {
    penas.crear({ pena: 'Peña A', telefono: '612345678', telegramId: '1',
      dias: [{ fecha: '2026-09-19', lineas: [linea('Barra', 10), linea('Asado', 2)] }] });
    penas.crear({ pena: 'Peña B', telefono: '622345678', telegramId: '2',
      dias: [{ fecha: '2026-09-19', lineas: [linea('Barra', 5)] }] });

    expect(penas.totalesDia('2026-09-19')).toEqual([
      { producto: 'Barra', cantidad: 15 },
      { producto: 'Asado', cantidad: 2 },
    ]);
  });

  it('numera los pedidos y sobrevive a un reinicio', () => {
    const a = penas.crear({ pena: 'Peña A', telefono: '612345678', telegramId: '1',
      dias: [{ fecha: '2026-09-19', lineas: [linea('Barra', 1)] }] });
    expect(a.numero).toBe('PÑ-0001');
    penas._reset();
    expect(penas.todos()).toHaveLength(1);
  });
});
