import { describe, it, expect } from 'vitest';
import { primaryFactCategory, stopsForFact } from '../fact-stops';

/**
 * Простои строки и факты (T-101, ОПЭ-73).
 *
 * Дефект: при вводе итога простои писались в каждый факт строки, и на ГП-РЦ (факты ГП и ПФ)
 * они задваивались в данных — тот же класс, что ОПЭ-38 у потребления. Правило: значение
 * получает только основной факт, остальные — нули.
 */
describe('основная категория факта', () => {
  it('берёт категорию продукции строки, если она среди записываемых', () => {
    expect(primaryFactCategory(['GP', 'PF'], 'GP')).toBe('GP');
    expect(primaryFactCategory(['PF', 'GP'], 'GP')).toBe('GP');
  });

  it('если категории продукции нет — первую записываемую', () => {
    expect(primaryFactCategory(['PF'], 'GP')).toBe('PF');
    expect(primaryFactCategory(['PF', 'GP'], 'MASS')).toBe('PF');
  });

  it('пустой набор — null, а не исключение', () => {
    expect(primaryFactCategory([], 'GP')).toBeNull();
  });
});

describe('простои на факт', () => {
  it('основной факт получает значение, остальные — нули', () => {
    const stops = { count: 2, durationMinutes: 30 };

    expect(stopsForFact('GP', 'GP', stops)).toEqual({ count: 2, durationMinutes: 30 });
    expect(stopsForFact('PF', 'GP', stops)).toEqual({ count: 0, durationMinutes: 0 });
  });

  it('без основной категории простои не пишутся никуда', () => {
    expect(stopsForFact('GP', null, { count: 1, durationMinutes: 10 })).toEqual({
      count: 0,
      durationMinutes: 0,
    });
  });
});
