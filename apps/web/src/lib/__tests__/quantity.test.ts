import { describe, it, expect } from 'vitest';
import { formatQuantity } from '../quantity';

/**
 * ОПЭ-32: количество целое, поэтому «2592», а не «2592.00».
 * Дробное значение из старых данных печатаем как есть.
 */
describe('formatQuantity', () => {
  it('целое печатает без хвоста', () => {
    expect(formatQuantity(2592)).toBe('2592');
    expect(formatQuantity('2592')).toBe('2592');
    expect(formatQuantity('2592.0000')).toBe('2592');
  });

  it('дробное старое значение не искажает', () => {
    expect(formatQuantity('2591.9999')).toBe('2591.9999');
  });

  it('ноль', () => {
    expect(formatQuantity(0)).toBe('0');
  });
});
