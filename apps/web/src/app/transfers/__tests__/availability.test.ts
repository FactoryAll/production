import { describe, it, expect } from 'vitest';
import {
  buildStockByWarehouse,
  formatQuantity,
  getAvailableQuantity,
  isQuantityOverAvailable,
  parseQuantityInput,
  type StockByWarehouse,
} from '../availability';

const stock: StockByWarehouse = {
  'wh-prod': { 'p-1': 115, 'p-2': 100 },
  'wh-gp': { 'p-1': 20 },
};

describe('buildStockByWarehouse', () => {
  it('groups balances by warehouse and product', () => {
    const result = buildStockByWarehouse([
      { warehouseId: 'wh-prod', productId: 'p-1', quantity: '115.00' },
      { warehouseId: 'wh-prod', productId: 'p-2', quantity: 100 },
      { warehouseId: 'wh-gp', productId: 'p-1', quantity: 20 },
    ]);

    expect(result).toEqual({
      'wh-prod': { 'p-1': 115, 'p-2': 100 },
      'wh-gp': { 'p-1': 20 },
    });
  });

  it('returns an empty map for no balances', () => {
    expect(buildStockByWarehouse([])).toEqual({});
  });
});

describe('getAvailableQuantity', () => {
  it('returns the balance for the given warehouse and product', () => {
    expect(getAvailableQuantity(stock, 'wh-prod', 'p-1')).toBe(115);
    expect(getAvailableQuantity(stock, 'wh-gp', 'p-1')).toBe(20);
  });

  it('returns 0 when the product has no balance on the warehouse', () => {
    expect(getAvailableQuantity(stock, 'wh-gp', 'p-2')).toBe(0);
  });

  it('returns 0 when warehouse or product is not selected yet', () => {
    expect(getAvailableQuantity(stock, '', 'p-1')).toBe(0);
    expect(getAvailableQuantity(stock, 'wh-prod', '')).toBe(0);
  });

  it('adds the quantity already issued by the transfer being edited', () => {
    // p-1 on production warehouse is 115, but 40 units were already issued by this transfer.
    expect(getAvailableQuantity(stock, 'wh-prod', 'p-1', 40)).toBe(155);
  });
});

describe('parseQuantityInput', () => {
  it('parses plain and decimal-comma values', () => {
    expect(parseQuantityInput('50')).toBe(50);
    expect(parseQuantityInput('50.25')).toBe(50.25);
    expect(parseQuantityInput('50,25')).toBe(50.25);
  });

  it('returns null for empty and invalid input', () => {
    expect(parseQuantityInput('')).toBeNull();
    expect(parseQuantityInput('   ')).toBeNull();
    expect(parseQuantityInput('abc')).toBeNull();
  });
});

describe('isQuantityOverAvailable', () => {
  it('flags quantities above the available stock', () => {
    expect(isQuantityOverAvailable(120, 115)).toBe(true);
    expect(isQuantityOverAvailable(1000, 115)).toBe(true);
  });

  it('accepts quantities equal to or below the available stock', () => {
    expect(isQuantityOverAvailable(115, 115)).toBe(false);
    expect(isQuantityOverAvailable(50, 115)).toBe(false);
  });

  it('does not flag empty input', () => {
    expect(isQuantityOverAvailable(null, 0)).toBe(false);
  });
});

describe('formatQuantity', () => {
  it('formats with two decimals', () => {
    expect(formatQuantity(115)).toBe('115.00');
    expect(formatQuantity(0)).toBe('0.00');
    expect(formatQuantity(12.5)).toBe('12.50');
  });
});
