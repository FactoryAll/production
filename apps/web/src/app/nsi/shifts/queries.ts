// Серверный поиск и постраничная выборка смен (M01 §8, T-058).
//
// Обычный модуль без 'use server': функции чтения данных (урок Фазы 3).

import type { Shift } from '@prisma/client';
import { prisma } from '@prodtrack/db';
import { activeWhere, type ActiveFilter } from '@/lib/nsi-list';
import { parsePageParam, toPageResult, type PageResult } from '@/lib/pagination';

/** Размер страницы списка смен. */
export const SHIFTS_PAGE_SIZE = 50;

/** Условие выборки: поиск по дате (ГГГГ-ММ-ДД) или номеру смены + фильтр активности. */
export function shiftWhere(filter: { q?: string; active?: ActiveFilter }) {
  const where = activeWhere(filter.active ?? 'ALL');
  const query = filter.q?.trim();
  if (!query) {
    return where;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(query)) {
    where.date = new Date(query);
    return where;
  }
  const number = Number.parseInt(query, 10);
  if (Number.isFinite(number)) {
    where.number = number;
  }
  return where;
}

/** Страница смен: поиск по дате/номеру и пагинация без отдельного `count`. */
export async function getShiftsPage(
  filter: { q?: string; active?: ActiveFilter },
  pageParam?: string,
): Promise<PageResult<Shift>> {
  const params = parsePageParam(pageParam, SHIFTS_PAGE_SIZE);

  const rows = await prisma.shift.findMany({
    where: shiftWhere(filter),
    orderBy: [{ date: 'desc' }, { number: 'asc' }],
    skip: params.skip,
    take: params.take,
  });

  return toPageResult(rows, params);
}
