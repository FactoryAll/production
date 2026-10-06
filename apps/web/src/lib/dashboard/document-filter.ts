// Типы и статусы фильтра списка документов дашборда (M11 §8).
//
// Модуль без доступа к БД: его импортируют и клиентские компоненты (варианты фильтров),
// и загрузчики (построение условия выборки).

import type { DocumentType, GoodsTransferStatus, ProductionOrderStatus } from '@prisma/client';

export const PRODUCTION_ORDER_STATUSES: ProductionOrderStatus[] = [
  'DRAFT',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
];

export const GOODS_TRANSFER_STATUSES: GoodsTransferStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'RECEIVED',
  'DISCREPANCY',
  'RECONCILED',
  'CANCELLED',
];

export type DashboardDocumentFilterType = 'ALL' | DocumentType;

export interface DashboardDocumentFilter {
  type: DashboardDocumentFilterType;
  status: 'ALL' | string;
}

/** Статус применим к типу документа, только если он есть в его статусной модели (00 §3). */
export function statusAppliesTo(
  status: DashboardDocumentFilter['status'],
  type: DocumentType,
): boolean {
  if (status === 'ALL') {
    return true;
  }
  const vocabulary = type === 'PRODUCTION_ORDER' ? PRODUCTION_ORDER_STATUSES : GOODS_TRANSFER_STATUSES;
  return (vocabulary as string[]).includes(status);
}
