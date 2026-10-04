// Общие хелперы списков НСИ: серверный поиск и фильтр активности (M01 §8, T-058).
//
// Обычный модуль без 'use server' / 'use client'.

export type ActiveFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';

/** Разбирает фильтр активности из строки запроса: некорректные значения → «все». */
export function parseActiveFilter(value: string | undefined): ActiveFilter {
  return value === 'ACTIVE' || value === 'INACTIVE' ? value : 'ALL';
}

/** Условие выборки по активности (пустой объект для «все»). */
export function activeWhere(filter: ActiveFilter): Record<string, unknown> {
  if (filter === 'ACTIVE') {
    return { active: true };
  }
  if (filter === 'INACTIVE') {
    return { active: false };
  }
  return {};
}

/**
 * Условие поиска по перечисленным полям без учёта регистра.
 * Пустой запрос не накладывает условий.
 */
export function searchOr(
  query: string | undefined,
  fields: readonly string[],
): Record<string, unknown> {
  const trimmed = query?.trim();
  if (!trimmed) {
    return {};
  }
  return {
    OR: fields.map((field) => ({ [field]: { contains: trimmed, mode: 'insensitive' } })),
  };
}

/** Условие списка НСИ: поиск по полям + фильтр активности. */
export function nsiListWhere(
  query: string | undefined,
  active: ActiveFilter,
  fields: readonly string[],
) {
  return { ...searchOr(query, fields), ...activeWhere(active) };
}
