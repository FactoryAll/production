import type { GoodsTransfer, TransferLine, Warehouse, Product } from '@prisma/client';
import { prisma } from '@prodtrack/db';
import { requireAnyPermission, requirePermission } from '@/lib/auth/access';
import { parsePageParam, toPageResult, type PageResult } from '@/lib/pagination';
import { buildStockByWarehouse } from './availability';

/** Перемещение со строками и складами — как отдаёт список. */
export type GoodsTransferWithLines = GoodsTransfer & {
  sourceWarehouse: Warehouse;
  destinationWarehouse: Warehouse;
  lines: Array<TransferLine & { product: Product }>;
};

export async function getTransfers() {
  await requireAnyPermission(['transfer:read']);

  return prisma.goodsTransfer.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      sourceWarehouse: true,
      destinationWarehouse: true,
      lines: {
        include: {
          product: true,
        },
      },
    },
  });
}

/** Размер страницы списка Перемещений. */
export const TRANSFERS_PAGE_SIZE = 50;

export const TRANSFER_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'RECEIVED',
  'DISCREPANCY',
  'RECONCILED',
  'CANCELLED',
] as const;

export type TransferStatusFilter = 'ALL' | (typeof TRANSFER_STATUSES)[number];

/** Разбирает фильтр статуса из строки запроса: неизвестное значение → «все». */
export function parseTransferStatusFilter(value: string | undefined): TransferStatusFilter {
  return TRANSFER_STATUSES.includes(value as (typeof TRANSFER_STATUSES)[number])
    ? (value as TransferStatusFilter)
    : 'ALL';
}

/** Условие выборки списка Перемещений. */
export function transferWhere(filter: { status?: TransferStatusFilter }) {
  return filter.status && filter.status !== 'ALL' ? { status: filter.status } : {};
}

/** Страница Перемещений: фильтр по статусу и пагинация без отдельного `count`. */
export async function getTransfersPage(
  filter: { status?: TransferStatusFilter },
  pageParam?: string,
): Promise<PageResult<GoodsTransferWithLines>> {
  await requireAnyPermission(['transfer:read']);

  const params = parsePageParam(pageParam, TRANSFERS_PAGE_SIZE);

  const transfers = await prisma.goodsTransfer.findMany({
    where: transferWhere(filter),
    orderBy: { createdAt: 'desc' },
    include: {
      sourceWarehouse: true,
      destinationWarehouse: true,
      lines: { include: { product: true } },
    },
    skip: params.skip,
    take: params.take,
  });

  return toPageResult(transfers as GoodsTransferWithLines[], params);
}

export async function getTransferById(id: string) {
  await requireAnyPermission(['transfer:read']);

  return prisma.goodsTransfer.findUnique({
    where: { id },
    include: {
      sourceWarehouse: true,
      destinationWarehouse: true,
      submittedBy: { select: { id: true, login: true } },
      lines: {
        include: {
          product: true,
          discrepancies: true,
        },
      },
    },
  });
}

export async function getTransferCreateData() {
  await requirePermission('transfer:create');

  const [warehouses, products, balances] = await Promise.all([
    prisma.warehouse.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.product.findMany({ where: { active: true, category: 'GP' }, orderBy: { code: 'asc' } }),
    prisma.stockBalance.findMany({
      where: { stockCategory: 'GP' },
      select: { warehouseId: true, productId: true, quantity: true },
    }),
  ]);

  return { warehouses, products, stockByWarehouse: buildStockByWarehouse(balances) };
}
