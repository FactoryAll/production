// Чистые хелперы экрана «Хронометраж» (M10 §8).
//
// Обычный модуль без 'use server' (урок Фазы 3).

import { DocumentType, EntityType } from '@prodtrack/contracts';

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  [DocumentType.PRODUCTION_ORDER]: 'ПЗ',
  [DocumentType.GOODS_TRANSFER]: 'Перемещение',
};

export const ENTITY_TYPE_LABELS: Record<string, string> = {
  [EntityType.DOCUMENT]: 'документ',
  [EntityType.LINE]: 'строка',
};

/** Названия статусов документов и строк (00 §3). */
export const STATUS_LABELS: Record<string, string> = {
  '': 'создание',
  DRAFT: 'Черновик',
  CONFIRMED: 'Подтверждено',
  IN_PROGRESS: 'В работе',
  COMPLETED: 'Завершено',
  CANCELLED: 'Отменено',
  ASSIGNED: 'Назначено',
  ACCEPTED: 'Получение подтверждено',
  REPORTED: 'Итог внесён',
  SUBMITTED: 'Отправлено',
  RECEIVED: 'Принято',
  DISCREPANCY: 'Расхождение',
  RECONCILED: 'Согласовано',
};

export function statusLabel(status: string | null): string {
  if (status === null) {
    return 'текущий этап';
  }
  return STATUS_LABELS[status] ?? status;
}

export function transitionLabel(fromStatus: string, toStatus: string | null): string {
  return statusLabel(fromStatus) + ' → ' + (toStatus === null ? '…' : statusLabel(toStatus));
}

export function documentTypeLabel(type: string): string {
  return DOCUMENT_TYPE_LABELS[type] ?? type;
}

export function entityTypeLabel(type: string): string {
  return ENTITY_TYPE_LABELS[type] ?? type;
}

/** Инициатор перехода: роль + пользователь (M10 BR-2). */
export function initiatorLabel(role: string | null, userId: string | null): string {
  if (!role && !userId) {
    return '—';
  }
  const shortUser = userId ? userId.slice(0, 8) : null;
  return [role, shortUser].filter(Boolean).join(' / ');
}
