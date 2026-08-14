import { nombreArchivo, mesDelDocumento, lineasQueNoCuadran, DocumentoProveedor } from '../src/services/facturaExtractor';

const base: DocumentoProveedor = {
  tipo: 'factura',
  proveedor: 'HIJOS DE VALENTÍN GANGOSO, S.A.',
  num_documento: 'FV/2026/1234',
  fecha: '2026-07-31',
  lineas: [],
};

describe('facturaExtractor', () => {
  it('nombra el fichero como "Proveedor nº fecha"', () => {
    // La barra del número de factura no vale en un nombre de fichero.
    expect(nombreArchivo(base)).toBe('HIJOS DE VALENTÍN GANGOSO, S.A. FV-2026-1234 2026-07-31.pdf');
  });

  it('no deja el nombre vacío si el modelo no leyó el proveedor', () => {
    expect(nombreArchivo({ ...base, proveedor: '', num_documento: '' }))
      .toBe('Proveedor desconocido s-n 2026-07-31.pdf');
  });

  it('archiva con la marca, que es como está el histórico', () => {
    // El histórico del Drive dice "DonDomino", no "Soluciones Corporativas".
    const doc = { ...base, proveedor: 'Soluciones Corporativas IP, S.L.', nombre_comercial: 'DonDomino' };
    expect(nombreArchivo(doc)).toBe('DonDomino FV-2026-1234 2026-07-31.pdf');
  });

  it('archiva en el mes de la factura, no en el de hoy', () => {
    // Una factura del 31 de julio que llega en papel en agosto va a julio.
    expect(mesDelDocumento(base)).toEqual({ anio: '2026', mes: '07' });
  });

  it('detecta la línea cuya multiplicación no cuadra', () => {
    // El fallo real del parser posicional: un "1" y un "7.05" pegados en
    // "17.05". Aquí el importe delata que la cantidad está mal leída.
    const doc: DocumentoProveedor = {
      ...base,
      lineas: [
        { descripcion: 'Harina de trigo', cantidad: 530, precio_unitario: 0.32, importe: 169.6 },
        { descripcion: 'Levadura', cantidad: 17.05, precio_unitario: 7.05, importe: 7.05 },
      ],
    };
    const malas = lineasQueNoCuadran(doc);
    expect(malas).toHaveLength(1);
    expect(malas[0]!.descripcion).toBe('Levadura');
  });

  it('acepta el descuento en línea al comprobar el cuadre', () => {
    const doc: DocumentoProveedor = {
      ...base,
      lineas: [{ descripcion: 'Aceite', cantidad: 10, precio_unitario: 5, descuento_pct: 10, importe: 45 }],
    };
    expect(lineasQueNoCuadran(doc)).toHaveLength(0);
  });
});
