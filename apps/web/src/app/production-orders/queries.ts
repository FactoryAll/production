// Серверный фильтр и постраничная выборка производственных заданий (T-057/T-058).
//
// Обычный модуль без 'use server': запросы данных не держим в файлах действий
// (урок Фазы 3).

import type { ProductionOrder, ProductionOrderLine, Shift, WorkCenter } from '@prisma/client';
import { prisma } from '@prodtrack/db';
import { requirePermission } from '@/lib/auth/access';
import { parsePageParam, toPageResult, type PageResult } from '@/lib/pagination';

/** Размер страницы списка ПЗ. */
export const ORDERS_PAGE_SIZE = 50;

export const ORDER_STATUSES = ['DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;

export type OrderStatusFilter = 'ALL' | (typeof ORDER_STATUSES)[number];

export type ProductionOrderWithLines = ProductionOrder & {
  shift: Shift;
  lines: Array<ProductionOrderLine & { workCenter: WorkCenter }>;
};

/** Разбирает фильтр статуса из строки запроса: неизвестное значение → «все». */
export function parseOrderStatusFilter(value: string | undefined): OrderStatusFilter {
  return ORDER_STATUSES.includes(value as (typeof ORDER_STATUSES)[number])
    ? (value as OrderStatusFilter)
    : 'ALL';
}

/** Условие выборки списка ПЗ. */
export function orderWhere(filter: { status?: OrderStatusFilter }) {
  return filter.status && filter.status !== 'ALL' ? { status: filter.status } : {};
}

/** Страница ПЗ: фильтр по статусу и пагинация без отдельного `count`. */
export async function getOrdersPage(
  filter: { status?: OrderStatusFilter },
  pageParam?: string,
): Promise<PageResult<ProductionOrderWithLines>> {
  await requirePermission('production_order:read');

  const params = parsePageParam(pageParam, ORDERS_PAGE_SIZE);

  const orders = await prisma.productionOrder.findMany({
    where: orderWhere(filter),
    orderBy: { createdAt: 'desc' },
    include: {
      shift: true,
      lines: { include: { workCenter: true } },
    },
    skip: params.skip,
    take: params.take,
  });

  return toPageResult(orders as ProductionOrderWithLines[], params);
}
