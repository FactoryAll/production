// Серверный поиск и постраничная выборка номенклатуры (M01 §8, T-058).
//
// Обычный модуль без 'use server': функции чтения данных (урок Фазы 3).

import type { Product } from '@prisma/client';
import { prisma } from '@prodtrack/db';
import { nsiListWhere, parseActiveFilter, type ActiveFilter } from '@/lib/nsi-list';
import { parsePageParam, toPageResult, type PageResult } from '@/lib/pagination';

export { parseActiveFilter, type ActiveFilter };

/** Размер страницы списка номенклатуры. */
export const PRODUCTS_PAGE_SIZE = 50;

/** Условие выборки: поиск по коду и наименованию (M01 §8) + фильтр активности. */
export function productWhere(filter: { q?: string; active?: ActiveFilter }) {
  return nsiListWhere(filter.q, filter.active ?? 'ALL', ['code', 'name']);
}

/** Страница номенклатуры: серверный поиск и пагинация без отдельного `count`. */
export async function getProductsPage(
  filter: { q?: string; active?: ActiveFilter },
  pageParam?: string,
): Promise<PageResult<Product>> {
  const params = parsePageParam(pageParam, PRODUCTS_PAGE_SIZE);

  const products = await prisma.product.findMany({
    where: productWhere(filter),
    orderBy: { code: 'asc' },
    skip: params.skip,
    take: params.take,
  });

  return toPageResult(products, params);
}
