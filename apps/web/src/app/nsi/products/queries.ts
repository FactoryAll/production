// Серверный поиск и постраничная выборка номенклатуры (M01 §8, T-058).
//
// Обычный модуль без 'use server': функции чтения данных (урок Фазы 3).

import type { Product } from '@prisma/client';
import { prisma } from '@prodtrack/db';
import { parsePageParam, toPageResult, type PageResult } from '@/lib/pagination';

export type ActiveFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';

/** Размер страницы списка номенклатуры. */
export const PRODUCTS_PAGE_SIZE = 50;

/** Разбирает фильтр активности из строки запроса. */
export function parseActiveFilter(value: string | undefined): ActiveFilter {
  return value === 'ACTIVE' || value === 'INACTIVE' ? value : 'ALL';
}

/** Условие выборки: поиск по коду и наименованию (M01 §8) + фильтр активности. */
export function productWhere(filter: { q?: string; active?: ActiveFilter }) {
  const where: Record<string, unknown> = {};
  const query = filter.q?.trim();

  if (query) {
    where.OR = [
      { code: { contains: query, mode: 'insensitive' } },
      { name: { contains: query, mode: 'insensitive' } },
    ];
  }
  if (filter.active === 'ACTIVE') {
    where.active = true;
  }
  if (filter.active === 'INACTIVE') {
    where.active = false;
  }

  return where;
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
