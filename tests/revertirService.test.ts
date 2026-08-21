import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'revertir-'));
process.env['REVERTIR_PATH'] = path.join(tmp, 'revertir.json');

import * as revertir from '../src/services/revertirService';
import { Cambio } from '../src/services/pedidosSemanaService';

const cambio = (fila: number, actual: number, nuevo: number): Cambio =>
  ({ fila, punto: 'HERBOLARIO', dia: 'lunes', producto: 'Barra', actual, nuevo, motivo: 'cerrado' });

describe('revertirService', () => {
  beforeEach(() => {
    try { fs.unlinkSync(process.env['REVERTIR_PATH']!); } catch { /* no existía */ }
    revertir._reset();
  });

  it('guarda el camino de vuelta, no el de ida', () => {
    // Se aplicó 1 → 0; para deshacerlo hay que volver a poner 1.
    const p = revertir.anotar('cerrado la semana que viene', [cambio(160, 1, 0)], '2026-08-21');
    expect(p.vuelta[0]).toMatchObject({ fila: 160, actual: 0, nuevo: 1 });
  });

  it('recuerda el día de la carga semanal, no cualquier día', () => {
    // Viernes 21/08 → el siguiente viernes es el 28.
    expect(revertir.proximoDiaDeCarga('2026-08-21')).toBe('2026-08-28');
    // Lunes 24/08 → el viernes de esa misma semana.
    expect(revertir.proximoDiaDeCarga('2026-08-24')).toBe('2026-08-28');
  });

  it('no avisa antes de tiempo', () => {
    revertir.anotar('cerrado', [cambio(160, 1, 0)], '2026-08-24');
    expect(revertir.paraAvisar('2026-08-26')).toHaveLength(0);
    expect(revertir.paraAvisar('2026-08-28')).toHaveLength(1);
  });

  it('si no se atiende el aviso, vuelve a avisar a la semana siguiente', () => {
    const p = revertir.anotar('cerrado', [cambio(160, 1, 0)], '2026-08-24');
    revertir.marcarAvisado(p.id, '2026-08-28');
    expect(revertir.paraAvisar('2026-08-28')).toHaveLength(0);
    expect(revertir.paraAvisar('2026-09-04')).toHaveLength(1);
    // Y sigue pendiente: avisar no es lo mismo que resolver.
    expect(revertir.pendientes()).toHaveLength(1);
  });

  it('deshacerlo o descartarlo lo saca de la lista', () => {
    const a = revertir.anotar('uno', [cambio(160, 1, 0)], '2026-08-24');
    const b = revertir.anotar('dos', [cambio(161, 2, 0)], '2026-08-24');
    revertir.cerrar(a.id, 'revertido');
    revertir.cerrar(b.id, 'descartado');
    expect(revertir.pendientes()).toHaveLength(0);
    // Cerrar dos veces no hace nada raro.
    expect(revertir.cerrar(a.id, 'revertido')).toBeNull();
  });

  it('sobrevive a un reinicio', () => {
    revertir.anotar('cerrado', [cambio(160, 1, 0)], '2026-08-24');
    revertir._reset();
    expect(revertir.pendientes()).toHaveLength(1);
  });
});
