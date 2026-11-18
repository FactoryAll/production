import { describe, it, expect } from 'vitest';
import {
  assertConsumptionAllowedForWorkCenter,
  assertOutputAllowedForWorkCenter,
  assertConsumptionMatchesLineProduct,
  isConsumptionOptionAllowed,
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

  it('на обычном РЦ категория GP не отбивается: это значение по умолчанию у старых строк', () => {
    // 18.11.2026: НП не мог сохранить корректировку потребления — проверка отбивала GP.
    expect(() =>
      assertConsumptionAllowedForWorkCenter('03', [{ stockCategory: 'GP' }]),
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

/**
 * 18.11.2026: ПФ в потреблении — только номенклатура строки.
 * Повод: в ПЗ 3b9355c7 «Спрей АНТИБАКТЕР» списали ПФ 12 095, которого не производили,
 * остаток ушёл в −11 135.
 */
describe('ПФ только по номенклатуре строки (18.11.2026)', () => {
  const lineProduct = 'p-gp';

  it('чужой ПФ в потреблении отбивается', () => {
    expect(() =>
      assertConsumptionMatchesLineProduct('06', lineProduct, [{ productId: 'p-other', stockCategory: 'PF' }]),
    ).toThrow(/той номенклатуры/);
  });

  it('свой ПФ разрешён, Масса любой номенклатуры разрешена', () => {
    expect(() =>
      assertConsumptionMatchesLineProduct('06', lineProduct, [
        { productId: lineProduct, stockCategory: 'PF' },
        { productId: 'p-mass-any', stockCategory: 'MASS' },
      ]),
    ).not.toThrow();
  });

  it('на «Маркировке ЧЗ» Масса запрещена', () => {
    expect(() =>
      assertConsumptionMatchesLineProduct('13', lineProduct, [{ productId: 'p-mass-any', stockCategory: 'MASS' }]),
    ).toThrow(/только полуфабрикат/);
  });

  it('опции для клиента: чужой ПФ не предлагается', () => {
    expect(isConsumptionOptionAllowed('06', lineProduct, 'p-other', 'PF')).toBe(false);
    expect(isConsumptionOptionAllowed('06', lineProduct, lineProduct, 'PF')).toBe(true);
    expect(isConsumptionOptionAllowed('06', lineProduct, 'p-mass-any', 'MASS')).toBe(true);
  });
});
