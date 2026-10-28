// Серверный поиск и постраничная выборка: причины неявки работника (T-093, M01 §8).
//
// Обычный модуль без 'use server': функции чтения данных (урок Фазы 3).

import type { AbsenceReason } from '@prisma/client';
import { prisma } from '@prodtrack/db';
import { nsiListWhere, type ActiveFilter } from '@/lib/nsi-list';
import { parsePageParam, toPageResult, type PageResult } from '@/lib/pagination';

/** Размер страницы списка. */
export const ABSENCE_REASONS_PAGE_SIZE = 50;


/** Условие выборки: серверный поиск (M01 §8) + фильтр активности. */
export function absenceReasonWhere(filter: { q?: string; active?: ActiveFilter }) {
  return nsiListWhere(filter.q, filter.active ?? 'ALL', ['code', 'name']);
}

/** Страница списка: поиск и пагинация без отдельного `count`. */
export async function getAbsenceReasonPage(
  filter: { q?: string; active?: ActiveFilter },
  pageParam?: string,
): Promise<PageResult<AbsenceReason>> {
  const params = parsePageParam(pageParam, ABSENCE_REASONS_PAGE_SIZE);

  const rows = await prisma.absenceReason.findMany({
    where: absenceReasonWhere(filter),
    orderBy: { code: 'asc' },
    skip: params.skip,
    take: params.take,
  });

  return toPageResult(rows, params);
}
