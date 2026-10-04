// Серверный поиск и постраничная выборка: причины ввода за Оператора (M01 §8, T-058).
//
// Обычный модуль без 'use server': функции чтения данных (урок Фазы 3).

import type { SubstitutionReason } from '@prisma/client';
import { prisma } from '@prodtrack/db';
import { activeWhere, nsiListWhere, type ActiveFilter } from '@/lib/nsi-list';
import { parsePageParam, toPageResult, type PageResult } from '@/lib/pagination';

/** Размер страницы списка. */
export const SUBSTITUTION_REASONS_PAGE_SIZE = 50;


/** Условие выборки: серверный поиск (M01 §8) + фильтр активности. */
export function substitutionReasonWhere(filter: { q?: string; active?: ActiveFilter }) {
  return nsiListWhere(filter.q, filter.active ?? 'ALL', ['code', 'name']);
}

/** Страница списка: поиск и пагинация без отдельного `count`. */
export async function getSubstitutionReasonPage(
  filter: { q?: string; active?: ActiveFilter },
  pageParam?: string,
): Promise<PageResult<SubstitutionReason>> {
  const params = parsePageParam(pageParam, SUBSTITUTION_REASONS_PAGE_SIZE);

  const rows = await prisma.substitutionReason.findMany({
    where: substitutionReasonWhere(filter),
    orderBy: { code: 'asc' },
    skip: params.skip,
    take: params.take,
  });

  return toPageResult(rows, params);
}
