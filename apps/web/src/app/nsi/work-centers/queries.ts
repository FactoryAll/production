// Серверный поиск и постраничная выборка: РЦ (M01 §8, T-058).
//
// Обычный модуль без 'use server': функции чтения данных (урок Фазы 3).

import type { WorkCenter } from '@prisma/client';
import { prisma } from '@prodtrack/db';
import { activeWhere, nsiListWhere, type ActiveFilter } from '@/lib/nsi-list';
import { parsePageParam, toPageResult, type PageResult } from '@/lib/pagination';

/** Размер страницы списка. */
export const WORK_CENTERS_PAGE_SIZE = 50;


/** Условие выборки: серверный поиск (M01 §8) + фильтр активности. */
export function workCenterWhere(filter: { q?: string; active?: ActiveFilter }) {
  return nsiListWhere(filter.q, filter.active ?? 'ALL', ['code', 'name']);
}

/** Страница списка: поиск и пагинация без отдельного `count`. */
export async function getWorkCenterPage(
  filter: { q?: string; active?: ActiveFilter },
  pageParam?: string,
): Promise<PageResult<WorkCenter>> {
  const params = parsePageParam(pageParam, WORK_CENTERS_PAGE_SIZE);

  const rows = await prisma.workCenter.findMany({
    where: workCenterWhere(filter),
    orderBy: { code: 'asc' },
    skip: params.skip,
    take: params.take,
  });

  return toPageResult(rows, params);
}
