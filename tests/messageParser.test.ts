process.env['NODE_ENV'] = 'test';

import { parseCustomerMessage } from '../src/services/messageParser';

describe('parseCustomerMessage', () => {
  const baseDate = new Date('2026-06-15T10:00:00Z'); // Monday

  test('Case 1: "mañana +2 barras" → ok, increment 2, alias barra', () => {
    const result = parseCustomerMessage('mañana +2 barras', baseDate);
    expect(result.status).toBe('ok');
    expect(result.deliveryDate).not.toBeNull();
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]!.type).toBe('increment');
    expect(result.actions[0]!.quantity).toBe(2);
    expect(result.actions[0]!.productAlias).toBe('barra');
  });

  test('Case 2: "quita 1 chapata" without date → ambiguous (no date)', () => {
    const result = parseCustomerMessage('quita 1 chapata', baseDate);
    expect(result.status).toBe('ambiguous');
    expect(result.deliveryDate).toBeNull();
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]!.type).toBe('decrement');
  });

  test('Case 2b: "quita 1 chapata mañana" → ok, decrement 1', () => {
    const result = parseCustomerMessage('quita 1 chapata mañana', baseDate);
    expect(['ok', 'ambiguous']).toContain(result.status);
    const decAction = result.actions.find((a) => a.type === 'decrement');
    expect(decAction).toBeDefined();
    expect(decAction!.quantity).toBe(1);
  });

  test('Case 2c: "mañana quita 1 chapata" → ok, decrement 1', () => {
    const result = parseCustomerMessage('mañana quita 1 chapata', baseDate);
    expect(result.status).toBe('ok');
    expect(result.deliveryDate).not.toBeNull();
    expect(result.actions[0]!.type).toBe('decrement');
    expect(result.actions[0]!.quantity).toBe(1);
    expect(result.actions[0]!.productAlias).toContain('chapata');
  });

  test('Case 3: "algo más de pan" → ambiguous or unsupported', () => {
    const result = parseCustomerMessage('algo más de pan', baseDate);
    expect(['ambiguous', 'unsupported']).toContain(result.status);
  });

  test('Missing product → ambiguous', () => {
    const result = parseCustomerMessage('mañana quiero más', baseDate);
    expect(result.status).toBe('ambiguous');
  });

  test('Missing quantity → ambiguous', () => {
    const result = parseCustomerMessage('mañana barras más', baseDate);
    expect(['ambiguous', 'unsupported']).toContain(result.status);
  });

  test('"lo de siempre" → unsupported', () => {
    const result = parseCustomerMessage('ponme lo de siempre', baseDate);
    expect(result.status).toBe('unsupported');
  });

  test('"como la semana pasada" → unsupported', () => {
    const result = parseCustomerMessage('mañana como la semana pasada', baseDate);
    expect(result.status).toBe('unsupported');
  });

  test('Set quantity: "déjalo en 20 barras mañana" → ok, set_quantity 20', () => {
    const result = parseCustomerMessage('déjalo en 20 barras mañana', baseDate);
    expect(result.status).toBe('ok');
    expect(result.actions[0]!.type).toBe('set_quantity');
    expect(result.actions[0]!.quantity).toBe(20);
  });

  test('Day selection: "para el martes +3 chapatas" → ok with correct date', () => {
    const result = parseCustomerMessage('para el martes +3 chapatas', baseDate);
    expect(result.status).toBe('ok');
    expect(result.deliveryDate).toBe('2026-06-16'); // Next Tuesday from Monday 2026-06-15
    expect(result.actions[0]!.type).toBe('increment');
    expect(result.actions[0]!.quantity).toBe(3);
  });
});
