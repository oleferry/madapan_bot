process.env['NODE_ENV'] = 'test';

import { validateDelta, getThreshold } from '../src/services/orderService';
import { HoldedLine } from '../src/types';

const makeLine = (name: string, units: number): HoldedLine => ({
  id: 'line-1',
  sku: 'SKU001',
  name,
  units,
  price: 1,
  discount: 0,
  tax: 0,
});

describe('getThreshold', () => {
  test('Barra before cutoff → 10', () => {
    expect(getThreshold('Barra de pan', false)).toBe(10);
  });

  test('Barra after cutoff → 3', () => {
    expect(getThreshold('Barra de pan', true)).toBe(3);
  });

  test('Chapata before cutoff → 6', () => {
    expect(getThreshold('Chapata artesana', false)).toBe(6);
  });

  test('Chapata after cutoff → 2', () => {
    expect(getThreshold('Chapata artesana', true)).toBe(2);
  });

  test('Unknown product before cutoff → 5', () => {
    expect(getThreshold('Producto desconocido', false)).toBe(5);
  });

  test('Unknown product after cutoff → 2', () => {
    expect(getThreshold('Producto desconocido', true)).toBe(2);
  });
});

describe('validateDelta', () => {
  test('Valid increment within threshold before cutoff', () => {
    const line = makeLine('Barra de pan', 10);
    const result = validateDelta(line, 5, false); // threshold=10, delta=5 → valid
    expect(result.valid).toBe(true);
  });

  test('Delta exceeds threshold before cutoff → invalid', () => {
    const line = makeLine('Barra de pan', 10);
    const result = validateDelta(line, 11, false); // threshold=10, delta=11 → invalid
    expect(result.valid).toBe(false);
    expect(result.reason).toBeDefined();
  });

  test('Delta exceeds threshold after cutoff → invalid', () => {
    const line = makeLine('Barra de pan', 10);
    const result = validateDelta(line, 4, true); // threshold=3 after cutoff → invalid
    expect(result.valid).toBe(false);
  });

  test('Negative result → invalid', () => {
    const line = makeLine('Chapata', 1);
    const result = validateDelta(line, -5, false); // units would be -4 → invalid
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('negativa');
  });

  test('Delta=0 → valid', () => {
    const line = makeLine('Chapata', 5);
    const result = validateDelta(line, 0, false);
    expect(result.valid).toBe(true);
  });

  test('Reducing to zero → valid', () => {
    const line = makeLine('Chapata', 3);
    const result = validateDelta(line, -3, false); // 3-3=0 → valid
    expect(result.valid).toBe(true);
  });
});
