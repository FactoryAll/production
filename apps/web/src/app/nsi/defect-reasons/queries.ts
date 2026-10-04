// Серверный поиск и постраничная выборка: причины брака (M01 §8, T-058).
//
// Обычный модуль без 'use server': функции чтения данных (урок Фазы 3).

import type { DefectReason } from '@prisma/client';
import { prisma } from '@prodtrack/db';
import { activeWhere, nsiListWhere, type ActiveFilter } from '@/lib/nsi-list';
import { parsePageParam, toPageResult, type PageResult } from '@/lib/pagination';

/** Размер страницы списка. */
export const DEFECT_REASONS_PAGE_SIZE = 50;


/** Условие выборки: серверный поиск (M01 §8) + фильтр активности. */
export function defectReasonWhere(filter: { q?: string; active?: ActiveFilter }) {
  return nsiListWhere(filter.q, filter.active ?? 'ALL', ['code', 'name']);
}

/** Страница списка: поиск и пагинация без отдельного `count`. */
export async function getDefectReasonPage(
  filter: { q?: string; active?: ActiveFilter },
  pageParam?: string,
): Promise<PageResult<DefectReason>> {
  const params = parsePageParam(pageParam, DEFECT_REASONS_PAGE_SIZE);

  const rows = await prisma.defectReason.findMany({
    where: defectReasonWhere(filter),
    orderBy: { code: 'asc' },
    skip: params.skip,
    take: params.take,
  });

  return toPageResult(rows, params);
}
