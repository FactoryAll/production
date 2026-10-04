// Серверный поиск и постраничная выборка: склады (M01 §8, T-058).
//
// Обычный модуль без 'use server': функции чтения данных (урок Фазы 3).

import type { Warehouse } from '@prisma/client';
import { prisma } from '@prodtrack/db';
import { activeWhere, nsiListWhere, type ActiveFilter } from '@/lib/nsi-list';
import { parsePageParam, toPageResult, type PageResult } from '@/lib/pagination';

/** Размер страницы списка. */
export const WAREHOUSES_PAGE_SIZE = 50;


/** Условие выборки: серверный поиск (M01 §8) + фильтр активности. */
export function warehouseWhere(filter: { q?: string; active?: ActiveFilter }) {
  return nsiListWhere(filter.q, filter.active ?? 'ALL', ['name', 'description']);
}

/** Страница списка: поиск и пагинация без отдельного `count`. */
export async function getWarehousePage(
  filter: { q?: string; active?: ActiveFilter },
  pageParam?: string,
): Promise<PageResult<Warehouse>> {
  const params = parsePageParam(pageParam, WAREHOUSES_PAGE_SIZE);

  const rows = await prisma.warehouse.findMany({
    where: warehouseWhere(filter),
    orderBy: { name: 'asc' },
    skip: params.skip,
    take: params.take,
  });

  return toPageResult(rows, params);
}
