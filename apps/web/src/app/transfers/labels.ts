import type { GoodsTransfer } from '@prisma/client';

/**
 * Чистые презентационные хелперы для Перемещений.
 *
 * ВАЖНО: этот модуль НЕ должен содержать директиву 'use server'.
 * Всё, что экспортируется из 'use server'-файла, становится Server Reference,
 * и вызов такой функции во время рендера клиентского компонента падает с ошибкой
 * "Server Functions cannot be called during initial render".
 */
export const TRANSFER_STATUS_LABELS: Record<GoodsTransfer['status'], string> = {
  DRAFT: 'Черновик',
  SUBMITTED: 'Отправлено',
  RECEIVED: 'Принято',
  DISCREPANCY: 'Расхождение',
  RECONCILED: 'Согласовано',
  CANCELLED: 'Отменено',
};

export function transferStatusLabel(status: GoodsTransfer['status']): string {
  return TRANSFER_STATUS_LABELS[status] ?? status;
}
