import type { KanbanColumnKey } from './stage';
import { shiftWindowBounds, type ShiftWindow } from './current-shift';

/**
 * Этап самостоятельного перемещения на доске (решение владельца 31.10.2026, ОПЭ-74).
 *
 * Колонки 6–9 больше не строятся из строк ПЗ: привязки к строке нет, карточка перемещения —
 * самостоятельная. Отбор идёт **по дате документа в окне выбранной смены**, и других дат
 * у `GoodsTransfer` нет:
 *
 * | Колонка | Статус | Дата |
 * |---|---|---|
 * | Перемещение создано | `DRAFT` | `createdAt` |
 * | Отправлено | `SUBMITTED` | `submittedAt`, а если пусто — `updatedAt` |
 * | Принято складом | `RECEIVED`, `RECONCILED` | `updatedAt` |
 * | Расхождение | `DISCREPANCY` | `updatedAt` |
 * | Отменено | `CANCELLED` | `updatedAt` |
 *
 * `updatedAt` подходит для приёмки, потому что приёмка — это `update` статуса, а поле
 * `@updatedAt` в Prisma обновляется любым изменением записи. Отдельного поля «дата приёмки»
 * в схеме нет; если когда-нибудь понадобится точная дата приёмки (а не последнего изменения),
 * это будет отдельное поле и отдельная миграция.
 */

export interface TransferDates {
  status: string;
  createdAt: Date;
  updatedAt: Date;
  submittedAt: Date | null;
}

/** Дата, по которой перемещение относится к смене. */
export function transferEventDate(transfer: TransferDates): Date {
  if (transfer.status === 'DRAFT') {
    return transfer.createdAt;
  }
  if (transfer.status === 'SUBMITTED') {
    return transfer.submittedAt ?? transfer.updatedAt;
  }
  return transfer.updatedAt;
}

/** Колонка перемещения по статусу; null — статус вне контура. */
export function transferColumnForStatus(status: string): KanbanColumnKey | null {
  switch (status) {
    case 'DRAFT':
      return 'TRANSFER_DRAFT';
    case 'SUBMITTED':
      return 'TRANSFER_SUBMITTED';
    case 'RECEIVED':
    case 'RECONCILED':
      return 'RECEIVED';
    case 'DISCREPANCY':
      return 'DISCREPANCY';
    case 'CANCELLED':
      return 'CANCELLED';
    default:
      return null;
  }
}

/** Колонка перемещения для окна смены; null — дата документа вне этого окна. */
export function resolveTransferColumn(
  transfer: TransferDates,
  window: { from: Date; to: Date },
): KanbanColumnKey | null {
  const column = transferColumnForStatus(transfer.status);
  if (!column) {
    return null;
  }
  const date = transferEventDate(transfer);
  return date >= window.from && date <= window.to ? column : null;
}

/** Окно выбранной смены: от `Shift.start` её даты до `Shift.end` (с переходом через полночь). */
export function shiftWindow(shift: ShiftWindow): { from: Date; to: Date } | null {
  return shiftWindowBounds(shift);
}

/** Подпись пометки карточки перемещения. */
export function transferNote(transfer: TransferDates): string | null {
  if (transfer.status === 'SUBMITTED') {
    return 'в пути';
  }
  if (transfer.status === 'DISCREPANCY') {
    return 'расхождение';
  }
  if (transfer.status === 'RECONCILED') {
    return 'расхождение согласовано';
  }
  if (transfer.status === 'CANCELLED') {
    return 'перемещение отменено';
  }
  return null;
}
