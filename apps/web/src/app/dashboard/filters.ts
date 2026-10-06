// Разбор фильтров дашборда из строки запроса (M11 §8: фильтр по типу документа и статусу).

import {
  GOODS_TRANSFER_STATUSES,
  PRODUCTION_ORDER_STATUSES,
  type DashboardDocumentFilterType,
} from '@/lib/dashboard/document-filter';
import { statusLabel } from '@/app/timing/labels';

export const DOCUMENT_TYPE_OPTIONS: { value: DashboardDocumentFilterType; label: string }[] = [
  { value: 'ALL', label: 'Все документы' },
  { value: 'PRODUCTION_ORDER', label: 'ПЗ' },
  { value: 'GOODS_TRANSFER', label: 'Перемещения' },
];

/**
 * Статусы обоих типов документов без повторов (DRAFT и CANCELLED общие),
 * в порядке статусных моделей 00 §3.
 */
export const DOCUMENT_STATUS_OPTIONS: { value: string; label: string }[] = [
  ...PRODUCTION_ORDER_STATUSES.map((status) => ({ value: status as string, label: statusLabel(status) })),
  ...GOODS_TRANSFER_STATUSES.filter(
    (status) => !(PRODUCTION_ORDER_STATUSES as string[]).includes(status),
  ).map((status) => ({ value: status as string, label: statusLabel(status) })),
];

export function parseDocumentType(value: string | undefined | null): DashboardDocumentFilterType {
  return DOCUMENT_TYPE_OPTIONS.some((option) => option.value === value)
    ? (value as DashboardDocumentFilterType)
    : 'ALL';
}

export function parseDocumentStatus(value: string | undefined | null): string {
  return DOCUMENT_STATUS_OPTIONS.some((option) => option.value === value) ? (value as string) : 'ALL';
}
