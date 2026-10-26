import { describe, it, expect } from 'vitest';
import { consumptionCategoriesForWorkCenter, filterConsumableForWorkCenter } from '../consumable-stock';

/**
 * ОПЭ-59 (решение владельца 26.10.2026): РЦ «Маркировка ЧЗ» (код 13) получает
 * в потребление только полуфабрикат с Производственного склада.
 */
describe('правила потребления по РЦ', () => {
  const items = [
    { id: 'p1', category: 'MASS' as const },
    { id: 'p2', category: 'PF' as const },
    { id: 'p3', category: 'GP' as const },
  ];

  it('обычному ГП-РЦ доступны Масса и ПФ', () => {
    expect(consumptionCategoriesForWorkCenter('07')).toEqual(['MASS', 'PF']);
    expect(filterConsumableForWorkCenter(items, '07').map((item) => item.id)).toEqual(['p1', 'p2']);
  });

  it('«Маркировка ЧЗ» получает только ПФ', () => {
    expect(consumptionCategoriesForWorkCenter('13')).toEqual(['PF']);
    expect(filterConsumableForWorkCenter(items, '13').map((item) => item.id)).toEqual(['p2']);
  });
});
