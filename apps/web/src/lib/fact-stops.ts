/**
 * Простои строки ПЗ и факты (T-101, ОПЭ-73).
 *
 * Дефект, из-за которого появился модуль: оператор вносит итог одной формой, но фактов у линии
 * бывает два (ГП и ПФ), и `reportProductionFact` писал `stopsCount` / `stopsDurationMinutes`
 * в **каждый** факт. На ГП-РЦ простой задваивался в данных — тот же класс, что ОПЭ-38
 * у потребления (оно копировалось в каждый факт и списывалось дважды).
 *
 * Правило: простой принадлежит **одному** факту — основному для линии. «Основной» определяется
 * тем же правилом, что уже используют состав работников и потребление (`pickPrimaryFact`):
 * факт категории продукции строки, иначе первый из созданных. Вводить здесь второе правило
 * («максимум», «первый по порядку») нельзя — второе правило разъедется с первым.
 */

export interface StopsValue {
  count: number;
  durationMinutes: number;
}

/**
 * Основная категория среди записываемых фактов линии — по тому же правилу, что
 * `pickPrimaryFact(facts, line.product.category)`: категория продукции строки, иначе первая.
 */
export function primaryFactCategory(categories: readonly string[], lineCategory: string): string | null {
  if (categories.length === 0) {
    return null;
  }
  return categories.includes(lineCategory) ? lineCategory : (categories[0] ?? null);
}

/**
 * Простои для конкретного факта: значение получает только основной, остальные — нули.
 *
 * Для СТАРЫХ данных отчёт всё равно берёт значение с основного факта (там оно есть с момента
 * появления поля), поэтому дедупликация работает и без перезаписи истории.
 */
export function stopsForFact(category: string, primaryCategory: string | null, stops: StopsValue): StopsValue {
  if (primaryCategory === null || category !== primaryCategory) {
    return { count: 0, durationMinutes: 0 };
  }
  return { count: stops.count, durationMinutes: stops.durationMinutes };
}
