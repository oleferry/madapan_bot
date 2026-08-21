import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pagos-'));
process.env['PAGOS_PATH'] = path.join(tmp, 'pagos.json');

import * as pagos from '../src/services/pagosService';

describe('pagosService', () => {
  beforeEach(() => {
    try { fs.unlinkSync(process.env['PAGOS_PATH']!); } catch { /* no existía */ }
    pagos._reset();
  });

  it('una reserva a pagar en el local queda pendiente de cobro', () => {
    pagos.registrar('PZ-0001', 'local', 14.95);
    expect(pagos.de('PZ-0001')!.estado).toBe('pendiente');
    expect(pagos.etiqueta('PZ-0001')).toContain('Cobrar 14.95 € en el local');
  });

  it('el pago online confirmado deja de estar pendiente', () => {
    pagos.registrar('PZ-0002', 'online', 22);
    pagos.marcarPagado('PZ-0002', 'ch_123');
    const p = pagos.de('PZ-0002')!;
    expect(p.estado).toBe('pagado');
    expect(p.chargeId).toBe('ch_123');
    expect(pagos.etiqueta('PZ-0002')).toContain('PAGADO');
  });

  it('un pago online que se queda a medias avisa de cobrar en el local', () => {
    // El cliente pulsa "pagar" pero no termina: la reserva sigue viva y hay
    // que cobrarla al recoger, no darla por pagada.
    pagos.registrar('PZ-0003', 'online', 22);
    expect(pagos.etiqueta('PZ-0003')).toContain('sin completar');
    expect(pagos.pendientesDeCobro().map(p => p.orderNumber)).toContain('PZ-0003');
  });

  it('una reserva sin registro de pago se cobra en el local', () => {
    // Reservas anteriores a esta función: no hay dato, se cobra como siempre.
    expect(pagos.etiqueta('PZ-9999')).toBe('💶 Cobrar en el local');
  });

  it('sobrevive a un reinicio', () => {
    pagos.registrar('PZ-0004', 'online', 14.95);
    pagos.marcarPagado('PZ-0004', 'ch_9');
    pagos._reset();
    expect(pagos.de('PZ-0004')!.estado).toBe('pagado');
  });
});
