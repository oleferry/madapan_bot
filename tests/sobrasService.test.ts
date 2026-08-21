import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sobras-'));
process.env['SOBRAS_PATH'] = path.join(tmp, 'sobras.json');

import * as sobras from '../src/services/sobrasService';
import { Entrega, diaSemana, mediaPorDia } from '../src/services/historicoVentas';

// Cuatro sábados con 20 barras entregadas cada uno.
const SABADOS = ['2026-08-01', '2026-08-08', '2026-08-15', '2026-08-22'];
const entregas: Entrega[] = SABADOS.map(fecha => ({
  fecha, contactId: 'c1', cliente: 'El Arco',
  lineas: [{ sku: 'SKU06', name: 'Barra', units: 20 }],
}));

describe('sobrasService', () => {
  beforeEach(() => {
    try { fs.unlinkSync(process.env['SOBRAS_PATH']!); } catch { /* no existía */ }
    sobras._reset();
  });

  it('los sábados son sábados', () => {
    expect(diaSemana('2026-08-01')).toBe(6);
    expect(mediaPorDia(entregas, 'El Arco', 6)[0]!.media).toBe(20);
  });

  it('sin recuentos no inventa un ajuste: deja lo que se entrega', () => {
    const s = sobras.sugerirParaDia(entregas, 'El Arco', 6);
    expect(s[0]).toMatchObject({ entregadoMedio: 20, sobraMedia: 0, sugerido: 20, diasConSobras: 0 });
  });

  it('descuenta las sobras y redondea al alza', () => {
    // Sobran 3 y 4 barras en dos sábados: media 3,5 → vendido 16,5 → 17.
    sobras.registrar({ fecha: '2026-08-01', cliente: 'El Arco', registradoPor: 'x',
      lineas: [{ producto: 'Barra', sku: 'SKU06', cantidad: 3 }] });
    sobras.registrar({ fecha: '2026-08-08', cliente: 'El Arco', registradoPor: 'x',
      lineas: [{ producto: 'Barra', sku: 'SKU06', cantidad: 4 }] });

    const s = sobras.sugerirParaDia(entregas, 'El Arco', 6)[0]!;
    expect(s.sobraMedia).toBe(3.5);
    expect(s.vendidoMedio).toBe(16.5);
    // Quedarse corto deja a un cliente sin pan; pasarse deja una barra.
    expect(s.sugerido).toBe(17);
    expect(s.diasConSobras).toBe(2);
  });

  it('no mezcla días de la semana', () => {
    const conLunes: Entrega[] = [...entregas, {
      fecha: '2026-08-03', contactId: 'c1', cliente: 'El Arco',
      lineas: [{ sku: 'SKU06', name: 'Barra', units: 5 }],
    }];
    expect(mediaPorDia(conLunes, 'El Arco', 1)[0]!.media).toBe(5);
    expect(mediaPorDia(conLunes, 'El Arco', 6)[0]!.media).toBe(20);
  });

  it('volver a contar el mismo día sustituye, no suma', () => {
    sobras.registrar({ fecha: '2026-08-01', cliente: 'El Arco', registradoPor: 'x',
      lineas: [{ producto: 'Barra', sku: 'SKU06', cantidad: 3 }] });
    sobras.registrar({ fecha: '2026-08-01', cliente: 'El Arco', registradoPor: 'x',
      lineas: [{ producto: 'Barra', sku: 'SKU06', cantidad: 6 }] });

    expect(sobras.todas()).toHaveLength(1);
    expect(sobras.sobrasDe('El Arco', '2026-08-01')!.lineas[0]!.cantidad).toBe(6);
  });

  it('anotar que no sobró nada también cuenta', () => {
    // Un cero es un dato, no la ausencia de dato: baja la media de sobras.
    sobras.registrar({ fecha: '2026-08-01', cliente: 'El Arco', registradoPor: 'x',
      lineas: [{ producto: 'Barra', sku: 'SKU06', cantidad: 4 }] });
    sobras.registrar({ fecha: '2026-08-08', cliente: 'El Arco', registradoPor: 'x', lineas: [] });

    const s = sobras.sugerirParaDia(entregas, 'El Arco', 6)[0]!;
    // Solo el recuento que menciona la barra cuenta para su media.
    expect(s.diasConSobras).toBe(1);
    expect(s.sugerido).toBe(16);
  });

  it('sobrevive a un reinicio', () => {
    sobras.registrar({ fecha: '2026-08-01', cliente: 'El Arco', registradoPor: 'x',
      lineas: [{ producto: 'Barra', sku: 'SKU06', cantidad: 3 }] });
    sobras._reset();
    expect(sobras.sobrasDe('El Arco', '2026-08-01')!.lineas[0]!.cantidad).toBe(3);
  });
});
