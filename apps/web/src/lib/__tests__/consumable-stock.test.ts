import { describe, it, expect } from 'vitest';
import {
  assertConsumptionAllowedForWorkCenter,
  assertOutputAllowedForWorkCenter,
  producesPf,
  consumptionCategoriesForWorkCenter,
  filterConsumableForWorkCenter,
} from '../consumable-stock';

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

/**
 * 14.11.2026: правило «Маркировка ЧЗ — только ПФ» должно жить в одном месте и применяться
 * на сервере во всех путях. Раньше оно было только в экране исполнения, и карточка ПЗ
 * («Ввести за Оператора», корректировка НП) принимала Массу, если строка пришла из факта.
 */
describe('assertConsumptionAllowedForWorkCenter (14.11.2026)', () => {
  it('на «Маркировке ЧЗ» (13) Масса в потреблении запрещена', () => {
    expect(() =>
      assertConsumptionAllowedForWorkCenter('13', [{ stockCategory: 'MASS' }]),
    ).toThrow(/только полуфабрикат/);
  });

  it('на «Маркировке ЧЗ» полуфабрикат разрешён', () => {
    expect(() =>
      assertConsumptionAllowedForWorkCenter('13', [{ stockCategory: 'PF' }, { stockCategory: 'PF' }]),
    ).not.toThrow();
  });

  it('на обычном РЦ Масса и ПФ разрешены', () => {
    expect(() =>
      assertConsumptionAllowedForWorkCenter('03', [{ stockCategory: 'MASS' }, { stockCategory: 'PF' }]),
    ).not.toThrow();
  });

  it('строка без категории не блокируется: категорию подставит сервер', () => {
    expect(() => assertConsumptionAllowedForWorkCenter('13', [{}])).not.toThrow();
  });
});

/**
 * 14.11.2026, решение владельца: «Маркировка ЧЗ» потребляет только ПФ и **производит только ГП**,
 * без вариантов. Правило рядом с правилом потребления — одна пара функций на обе стороны.
 */
describe('производство по РЦ: ЧЗ выпускает только ГП (14.11.2026)', () => {
  it('на 13 выпуск ПФ запрещён', () => {
    expect(producesPf('13')).toBe(false);
    expect(() => assertOutputAllowedForWorkCenter('13', { PF: 10 })).toThrow(/только готовую продукцию/);
  });

  it('на 13 выпуск ГП разрешён', () => {
    expect(() => assertOutputAllowedForWorkCenter('13', { GP: 100 })).not.toThrow();
  });

  it('на обычном РЦ ПФ разрешён', () => {
    expect(producesPf('03')).toBe(true);
    expect(() => assertOutputAllowedForWorkCenter('03', { GP: 10, PF: 5 })).not.toThrow();
  });
});
