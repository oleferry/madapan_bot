import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'encargos-'));
process.env['ENCARGOS_PATH'] = path.join(tmp, 'encargos.json');

// eslint-disable-next-line @typescript-eslint/no-var-requires
import * as encargos from '../src/services/encargosService';

describe('encargosService', () => {
  beforeEach(() => {
    try { fs.unlinkSync(process.env['ENCARGOS_PATH']!); } catch { /* no existía */ }
    encargos._reset();
  });

  it('normaliza el teléfono para que el cliente sea el mismo', () => {
    expect(encargos.normalizarTelefono('666 12 34 56')).toBe('666123456');
    expect(encargos.normalizarTelefono('+34666123456')).toBe('666123456');
    expect(encargos.normalizarTelefono('666-123-456')).toBe('666123456');
  });

  it('distingue clientes con nombre parecido por el móvil', () => {
    encargos.crearEncargo({ fecha: '2026-08-14', telefono: '600000001',
      nombre: 'Carlos Magdaleno padre', lineas: [{ producto: 'Pan de cuadros', cantidad: 3 }],
      creadoPor: 'staff' });
    encargos.crearEncargo({ fecha: '2026-08-15', telefono: '600000002',
      nombre: 'Carlos Magdaleno hijo', lineas: [{ producto: 'Empanada de cecina', cantidad: 2 }],
      creadoPor: 'staff' });

    expect(encargos.listarClientes()).toHaveLength(2);
    expect(encargos.buscarCliente('600000001')!.nombre).toBe('Carlos Magdaleno padre');
  });

  it('reutiliza el cliente recurrente y le cuenta los encargos', () => {
    for (const fecha of ['2026-08-15', '2026-08-16']) {
      encargos.crearEncargo({ fecha, telefono: '600000003', nombre: 'Agapito',
        lineas: [{ producto: 'Barra grande', cantidad: fecha === '2026-08-15' ? 25 : 10 }],
        creadoPor: 'staff' });
    }
    const clientes = encargos.listarClientes();
    expect(clientes).toHaveLength(1);
    expect(clientes[0]!.totalEncargos).toBe(2);
    expect(clientes[0]!.ultimoEncargo).toBe('2026-08-16');
  });

  it('suma por producto y conserva las notas de preparación', () => {
    encargos.crearEncargo({ fecha: '2026-08-15', telefono: '600000004', nombre: 'Zamora',
      lineas: [{ producto: 'Pan de cuadros', cantidad: 6, nota: 'pocos hechos' }],
      creadoPor: 'staff' });
    encargos.crearEncargo({ fecha: '2026-08-15', telefono: '600000005', nombre: 'Jesús Banesto',
      lineas: [{ producto: 'Pan de cuadros', cantidad: 2 }], creadoPor: 'staff' });

    const totales = encargos.totalesDelDia('2026-08-15');
    expect(totales).toHaveLength(1);
    expect(totales[0]!.cantidad).toBe(8);
    // Los 6 "pocos hechos" no pueden perderse dentro del total de 8.
    expect(totales[0]!.notas[0]).toContain('pocos hechos');
    expect(totales[0]!.notas[0]).toContain('Zamora');
  });

  it('saca la nota de recogida en el texto de producción', () => {
    encargos.crearEncargo({ fecha: '2026-08-14', telefono: '600000006',
      nombre: 'Carlos Magdaleno padre',
      lineas: [{ producto: 'Empanada de atún y pisto', cantidad: 2 }],
      notaRecogida: 'con las pizzas, a las 21:00', creadoPor: 'staff' });

    const txt = encargos.textoProduccion('2026-08-14');
    expect(txt).toContain('2 × Empanada de atún y pisto');
    expect(txt).toContain('21:00');
  });

  it('el encargo cancelado no cuenta para producción', () => {
    const e = encargos.crearEncargo({ fecha: '2026-08-15', telefono: '600000007',
      nombre: 'Sara', lineas: [{ producto: 'Pan de cuadros pequeño', cantidad: 1 }],
      creadoPor: 'staff' });
    expect(encargos.totalesDelDia('2026-08-15')).toHaveLength(1);
    encargos.cancelarEncargo(e.id);
    expect(encargos.totalesDelDia('2026-08-15')).toHaveLength(0);
  });

  it('separa clientes recurrentes de clientes de paso', () => {
    // Agapito repite dos días: es recurrente. Rubén encarga una sola vez.
    for (const fecha of ['2026-08-15', '2026-08-16']) {
      encargos.crearEncargo({ fecha, telefono: '600000010', nombre: 'Agapito',
        lineas: [{ producto: 'Barra', cantidad: 25 }], creadoPor: 'staff' });
    }
    encargos.crearEncargo({ fecha: '2026-08-15', telefono: '600000011', nombre: 'Rubén',
      lineas: [{ producto: 'Tarta de limón', cantidad: 1 }], creadoPor: 'staff' });

    const r = encargos.resumenEncargos('2026-08-15', '2026-08-16');
    expect(r.recurrentes.encargos).toBe(2);
    expect(r.recurrentes.clientes).toBe(1);
    expect(r.recurrentes.totales[0]).toMatchObject({ producto: 'Barra', cantidad: 50 });
    expect(r.dePaso.encargos).toBe(1);
    expect(r.dePaso.totales[0]!.producto).toBe('Tarta de limón');
  });

  it('guarda los datos fiscales solo cuando piden factura', () => {
    encargos.crearEncargo({ fecha: '2026-08-15', telefono: '600000012', nombre: 'Bar La Plaza',
      lineas: [{ producto: 'Empanada de cecina', cantidad: 3 }],
      factura: { nif: 'B12345678', razonSocial: 'Bar La Plaza SL' }, creadoPor: 'staff' });
    encargos.crearEncargo({ fecha: '2026-08-15', telefono: '600000013', nombre: 'Sara',
      lineas: [{ producto: 'Pan de cuadros pequeño', cantidad: 1 }], creadoPor: 'staff' });

    // Del particular no se guarda ningún dato fiscal.
    expect(encargos.buscarCliente('600000013')!.factura).toBeUndefined();
    // Y los de la empresa quedan en la ficha, para no volver a pedirlos.
    expect(encargos.buscarCliente('600000012')!.factura!.nif).toBe('B12345678');

    const r = encargos.resumenEncargos('2026-08-15', '2026-08-15');
    expect(r.conFactura).toHaveLength(1);
    expect(encargos.textoResumen(r)).toContain('Bar La Plaza SL');
  });

  it('el resumen usa tabulador para poder pegarlo en la hoja', () => {
    encargos.crearEncargo({ fecha: '2026-08-15', telefono: '600000014', nombre: 'Mavi',
      lineas: [{ producto: 'Pan pasas y nueces', cantidad: 2 }], creadoPor: 'staff' });
    const txt = encargos.textoResumen(encargos.resumenEncargos('2026-08-15', '2026-08-15'));
    expect(txt).toContain('Pan pasas y nueces\t2');
  });

  it('sobrevive a un reinicio: los encargos persisten en disco', () => {
    encargos.crearEncargo({ fecha: '2026-08-16', telefono: '600000008', nombre: 'Rubén',
      lineas: [{ producto: 'Tarta de limón', cantidad: 1 }], creadoPor: 'staff' });
    encargos._reset();   // simula el reinicio del bot
    expect(encargos.totalesDelDia('2026-08-16')).toHaveLength(1);
    expect(encargos.buscarCliente('600000008')!.nombre).toBe('Rubén');
  });
});
