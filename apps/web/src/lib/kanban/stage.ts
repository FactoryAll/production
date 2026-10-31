/**
 * Этап карточки на доске контура (T-103, постановка `docs/kanban_design.md` §3–§4).
 *
 * Модуль **чистый**: никакой базы, только данные строки, её ПЗ, задачи 1С и привязанных
 * перемещений. Причина простая — именно здесь ошибаются тихо: неверно посчитанный этап
 * не падает, а показывает карточку не в той колонке, и ОТК принимает решение по картинке.
 *
 * Правило одно и записано числами: карточка стоит в **самой продвинутой** колонке, до которой
 * дошла строка. «Продвинутость» — это порядок этапов контура, а не порядок в базе.
 */

export type KanbanColumnKey =
  | 'DRAFT'
  | 'CONFIRMED'
  | 'IN_PROGRESS'
  | 'REPORTED'
  | 'CLOSED'
  | 'TRANSFER_DRAFT'
  | 'TRANSFER_SUBMITTED'
  | 'RECEIVED'
  | 'DISCREPANCY'
  | 'CANCELLED';

export interface KanbanColumn {
  key: KanbanColumnKey;
  title: string;
  /**
   * Колонка про ПЗ (1–5). Складским ролям они не рендерятся: у КСГП и УСГП нет
   * `production_order:read`, их часть контура начинается с перемещений.
   */
  isOrderColumn: boolean;
  /** Порядок этапа: карточка уходит в колонку с наибольшим порядком. */
  order: number;
}

export const KANBAN_COLUMNS: KanbanColumn[] = [
  { key: 'DRAFT', title: 'Черновик ПЗ', isOrderColumn: true, order: 1 },
  { key: 'CONFIRMED', title: 'Подтверждено', isOrderColumn: true, order: 2 },
  { key: 'IN_PROGRESS', title: 'В работе', isOrderColumn: true, order: 3 },
  // Логика не меняется: ПЗ закрывается автоматически, когда отчиталась ПОСЛЕДНЯЯ строка,
  // поэтому однострочное ПЗ уходит сразу в «Закрыто», а эта колонка — про часть смены
  // (ОПЭ-74: выглядело как поломка, поэтому подпись объясняет).
  { key: 'REPORTED', title: 'Отчёт сдан (когда отчиталась часть смены)', isOrderColumn: true, order: 4 },
  { key: 'CLOSED', title: 'Закрыто / задача 1С', isOrderColumn: true, order: 5 },
  { key: 'TRANSFER_DRAFT', title: 'Перемещение создано', isOrderColumn: false, order: 6 },
  { key: 'TRANSFER_SUBMITTED', title: 'Отправлено', isOrderColumn: false, order: 7 },
  { key: 'RECEIVED', title: 'Принято складом', isOrderColumn: false, order: 8 },
  { key: 'DISCREPANCY', title: 'Расхождение', isOrderColumn: false, order: 9 },
  { key: 'CANCELLED', title: 'Отменено', isOrderColumn: false, order: 10 },
];

export const KANBAN_COLUMN_BY_KEY: Record<KanbanColumnKey, KanbanColumn> = Object.fromEntries(
  KANBAN_COLUMNS.map((column) => [column.key, column]),
) as Record<KanbanColumnKey, KanbanColumn>;

export interface KanbanStageInput {
  orderStatus: string;
  lineStatus: string;
  /** Статус задачи 1С по ПЗ (`PENDING`, `PROCESSED`, `CANCELLED`); нет задачи — undefined. */
  oneCTaskStatus?: string | null;
}

export interface KanbanStage {
  column: KanbanColumnKey;
  /** Подпись под карточкой; null — подписывать нечего. */
  note: string | null;
  /** Перемещение, по которому карточка попала в колонку перемещений. */
  transferId: string | null;
  /**
   * Чем вызвана колонка «Отменено». Нужно правам: отменённое ПЗ — это данные ПЗ,
   * и складским ролям его карточка не показывается; отменённое перемещение — их данные.
   */
  cancelledBy: 'order' | 'transfer' | null;
}

/** Этап по самому ПЗ и строке: без перемещений. */
function orderStage(orderStatus: string, lineStatus: string): KanbanColumnKey {
  // Отмена — терминальна и перебивает всё остальное: отменённое ПЗ дальше по контуру не идёт.
  if (orderStatus === 'CANCELLED') {
    return 'CANCELLED';
  }
  if (orderStatus === 'COMPLETED') {
    return 'CLOSED';
  }
  if (lineStatus === 'REPORTED') {
    return 'REPORTED';
  }
  if (lineStatus === 'ACCEPTED') {
    return 'IN_PROGRESS';
  }
  // Строка ещё не принята оператором: черновик ПЗ или уже подтверждённое ПЗ.
  return orderStatus === 'DRAFT' ? 'DRAFT' : 'CONFIRMED';
}

/**
 * Этап строки ПЗ: только этапы 1–5.
 *
 * Перемещения сюда больше не входят (решение владельца 31.10.2026): колонки 6–9 показывают
 * самостоятельные карточки перемещений, у которых своя дата и свой статус. Строка ПЗ
 * завершает контур на «Закрыто / задача 1С».
 */
export function resolveKanbanStage(input: KanbanStageInput): KanbanStage {
  const column = orderStage(input.orderStatus, input.lineStatus);

  if (column === 'CANCELLED') {
    return { column: 'CANCELLED', note: 'ПЗ отменено', transferId: null, cancelledBy: 'order' };
  }

  const note = column === 'CLOSED' ? (input.oneCTaskStatus === 'PROCESSED' ? 'проведено' : 'ожидает 1С') : null;

  return { column, note, transferId: null, cancelledBy: null };
}

