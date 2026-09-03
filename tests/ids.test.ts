import { nuevoId } from '../src/utils/ids';

describe('nuevoId', () => {
  it('no repite aunque salgan todos en el mismo milisegundo', () => {
    const ids = Array.from({ length: 500 }, () => nuevoId('C'));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('mantiene el prefijo del tipo de registro', () => {
    expect(nuevoId('E')).toMatch(/^E[0-9A-Z]+$/);
  });
});
