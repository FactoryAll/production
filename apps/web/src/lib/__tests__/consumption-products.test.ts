import { describe, it, expect } from 'vitest';
import { filterConsumableProducts } from '../consumption-products';

/**
 * ОПЭ-31 (решение владельца 23.10.2026): РЦ, не производящий Массу, потребляет Массу
 * как источник для производства ГП и ПФ. ГП в его списке потребления быть не должно.
 */
describe('filterConsumableProducts', () => {
  const mass = { id: 'm-1', category: 'MASS' as const };
  const gp = { id: 'g-1', category: 'GP' as const };

  it('РЦ, не производящий Массу, видит только Массу', () => {
    expect(filterConsumableProducts([mass, gp], false)).toEqual([mass]);
  });

  it('РЦ, производящий Массу, видит прежний полный список', () => {
    expect(filterConsumableProducts([mass, gp], true)).toEqual([mass, gp]);
  });

  it('пустой список остаётся пустым', () => {
    expect(filterConsumableProducts([], false)).toEqual([]);
  });
});
