// Серверный поиск и постраничная выборка сотрудников (M01 §8, T-058).
//
// Обычный модуль без 'use server': функции чтения данных (урок Фазы 3).

import type { Employee } from '@prisma/client';
import { prisma } from '@prodtrack/db';
import { parsePageParam, toPageResult, type PageResult } from '@/lib/pagination';
import { parseActiveFilter, type ActiveFilter } from '../products/queries';

/** Размер страницы списка сотрудников. */
export const EMPLOYEES_PAGE_SIZE = 50;

/** Условие выборки: поиск по ФИО и табельному номеру (M01 §8) + фильтр активности. */
export function employeeWhere(filter: { q?: string; active?: ActiveFilter }) {
  const where: Record<string, unknown> = {};
  const query = filter.q?.trim();

  if (query) {
    where.OR = [
      { tabNumber: { contains: query, mode: 'insensitive' } },
      { fullName: { contains: query, mode: 'insensitive' } },
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

/** Страница сотрудников: серверный поиск и пагинация без отдельного `count`. */
export async function getEmployeesPage(
  filter: { q?: string; active?: ActiveFilter },
  pageParam?: string,
): Promise<PageResult<Employee>> {
  const params = parsePageParam(pageParam, EMPLOYEES_PAGE_SIZE);

  const employees = await prisma.employee.findMany({
    where: employeeWhere(filter),
    orderBy: { tabNumber: 'asc' },
    skip: params.skip,
    take: params.take,
  });

  return toPageResult(employees, params);
}

export { parseActiveFilter, type ActiveFilter };
