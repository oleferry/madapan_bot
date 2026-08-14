import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'compras-'));
process.env['COMPRAS_PATH'] = path.join(tmp, 'compras.json');

import * as compras from '../src/services/comprasService';
import { partir } from '../src/bot/compraFlow';

describe('comprasService', () => {
  beforeEach(() => {
    try { fs.unlinkSync(process.env['COMPRAS_PATH']!); } catch { /* no existía */ }
    compras._reset();
  });

  it('separa la cantidad de lo que se pide', () => {
    expect(partir('24 coca colas')).toEqual({ cantidad: 24, consulta: 'coca colas' });
    expect(partir('1,5 kg de harina')).toEqual({ cantidad: 1.5, consulta: 'kg de harina' });
    // Sin número delante, una unidad.
    expect(partir('servilletas')).toEqual({ cantidad: 1, consulta: 'servilletas' });
  });

  it('suma lo que varios apuntan del mismo artículo', () => {
    compras.aprenderProveedor('Coca - Cola', 'SKU31', 'p1', 'Ajá', 'aja@x.es');
    compras.apuntar({ texto: '24 coca colas', producto: 'Coca - Cola', sku: 'SKU31', cantidad: 24, apuntadoPor: 'a' });
    compras.apuntar({ texto: '12 coca colas', producto: 'Coca - Cola', sku: 'SKU31', cantidad: 12, apuntadoPor: 'b' });

    const grupos = compras.agruparPorProveedor();
    expect(grupos).toHaveLength(1);
    expect(grupos[0]!.lineas[0]).toMatchObject({ producto: 'Coca - Cola', cantidad: 36 });
    expect(grupos[0]!.proveedorEmail).toBe('aja@x.es');
  });

  it('recuerda el proveedor para no volver a preguntarlo', () => {
    expect(compras.proveedorDe('Harina trigo Castilla', 'MP-HAR-CAS')).toBeUndefined();
    compras.aprenderProveedor('Harina trigo Castilla', 'MP-HAR-CAS', 'p2', 'Gangoso', 'v@x.es');
    expect(compras.proveedorDe('Harina trigo Castilla', 'MP-HAR-CAS')!.proveedorNombre).toBe('Gangoso');
  });

  it('deja aparte lo que no tiene proveedor, al final', () => {
    compras.aprenderProveedor('Coca - Cola', 'SKU31', 'p1', 'Ajá', 'aja@x.es');
    compras.apuntar({ texto: 'servilletas', producto: 'servilletas', cantidad: 5, apuntadoPor: 'a' });
    compras.apuntar({ texto: '24 coca colas', producto: 'Coca - Cola', sku: 'SKU31', cantidad: 24, apuntadoPor: 'a' });

    const grupos = compras.agruparPorProveedor();
    expect(grupos[grupos.length - 1]!.proveedorNombre).toBe('Sin proveedor');
  });

  it('lo enviado deja de estar pendiente, lo demás sigue', () => {
    compras.aprenderProveedor('Coca - Cola', 'SKU31', 'p1', 'Ajá', 'aja@x.es');
    compras.apuntar({ texto: '24 coca colas', producto: 'Coca - Cola', sku: 'SKU31', cantidad: 24, apuntadoPor: 'a' });
    compras.apuntar({ texto: 'servilletas', producto: 'servilletas', cantidad: 5, apuntadoPor: 'a' });

    const aja = compras.agruparPorProveedor().find(g => g.proveedorNombre === 'Ajá')!;
    compras.marcarPedidos(aja.lineas.flatMap(l => l.ids), '2026-08-14');

    expect(compras.pendientes().map(p => p.producto)).toEqual(['servilletas']);
  });

  it('el borrador es quincenal, no semanal', () => {
    // Sin historial toca, porque nunca se ha hecho.
    expect(compras.tocaBorrador('2026-08-14')).toBe(true);
    compras.anotarBorrador('2026-08-14');
    expect(compras.tocaBorrador('2026-08-21')).toBe(false);  // una semana
    expect(compras.tocaBorrador('2026-08-28')).toBe(true);   // dos semanas
  });

  it('sobrevive a un reinicio', () => {
    compras.aprenderProveedor('Agua', 'SKU01', 'p3', 'Makro', 'm@x.es');
    compras.apuntar({ texto: '6 agua', producto: 'Agua', sku: 'SKU01', cantidad: 6, apuntadoPor: 'a' });
    compras._reset();
    expect(compras.pendientes()).toHaveLength(1);
    expect(compras.proveedorDe('Agua', 'SKU01')!.proveedorNombre).toBe('Makro');
  });
});
