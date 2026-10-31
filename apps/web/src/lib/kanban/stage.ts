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
  { key: 'REPORTED', title: 'Отчёт сдан', isOrderColumn: true, order: 4 },
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

/** Статусы перемещения в терминах колонок. `null` — статус вне контура. */
const TRANSFER_COLUMN: Record<string, KanbanColumnKey | null> = {
  DRAFT: 'TRANSFER_DRAFT',
  SUBMITTED: 'TRANSFER_SUBMITTED',
  RECEIVED: 'RECEIVED',
  RECONCILED: 'RECEIVED',
  DISCREPANCY: 'DISCREPANCY',
  CANCELLED: 'CANCELLED',
};

export interface KanbanStageInput {
  orderStatus: string;
  lineStatus: string;
  /** Статус задачи 1С по ПЗ (`PENDING`, `PROCESSED`, `CANCELLED`); нет задачи — undefined. */
  oneCTaskStatus?: string | null;
  /** Привязанные к строке перемещения. */
  transfers?: Array<{ id: string; status: string }>;
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
 * Перемещения строки в терминах этапа.
 *
 * Правило: берём **самое продвинутое неотменённое** перемещение. Отменённое перемещение
 * не должно утаскивать карточку в «Отменено», если рядом есть действующее: у строки бывает
 * несколько перемещений (возврат на доработку, повторный выпуск), и «одно отменили» не значит
 * «всё отменили». В «Отменено» карточка попадает, только если отменены все её перемещения.
 */
function transferStage(transfers: Array<{ id: string; status: string }>): KanbanStage | null {
  const mapped = transfers
    .map((transfer) => ({ transfer, column: TRANSFER_COLUMN[transfer.status] ?? null }))
    .filter((item): item is { transfer: { id: string; status: string }; column: KanbanColumnKey } =>
      item.column !== null,
    );

  if (mapped.length === 0) {
    return null;
  }

  const active = mapped.filter((item) => item.column !== 'CANCELLED');
  const pool = active.length > 0 ? active : mapped;
  const furthest = pool.reduce((best, item) =>
    KANBAN_COLUMN_BY_KEY[item.column].order > KANBAN_COLUMN_BY_KEY[best.column].order ? item : best,
  );

  return {
    column: furthest.column,
    note: null,
    transferId: furthest.transfer.id,
    cancelledBy: furthest.column === 'CANCELLED' ? 'transfer' : null,
  };
}

/**
 * Этап карточки: самая продвинутая колонка из всего, что известно о строке.
 *
 * Порядок вычисления явный, потому что от него зависит картинка:
 *   1. отменённое ПЗ — «Отменено» (терминально, дальше не смотрим);
 *   2. перемещения строки — их этап (6–9 или 10, если отменены все);
 *   3. иначе ПЗ и строка — этапы 1–5;
 *   4. итог — максимальный из (2) и (3) по порядку этапов.
 */
export function resolveKanbanStage(input: KanbanStageInput): KanbanStage {
  const base = orderStage(input.orderStatus, input.lineStatus);

  if (base === 'CANCELLED') {
    return { column: 'CANCELLED', note: 'ПЗ отменено', transferId: null, cancelledBy: 'order' };
  }

  const byTransfer = transferStage(input.transfers ?? []);
  const baseOrder = KANBAN_COLUMN_BY_KEY[base].order;
  const transferOrder = byTransfer ? KANBAN_COLUMN_BY_KEY[byTransfer.column].order : 0;

  const column = transferOrder > baseOrder ? byTransfer!.column : base;

  // Подпись «ожидает 1С / проведено» — только у закрытого ПЗ без перемещений:
  // как только продукция поехала, важнее складской этап.
  let note: string | null = null;
  if (column === 'CLOSED') {
    note = input.oneCTaskStatus === 'PROCESSED' ? 'проведено' : 'ожидает 1С';
  }
  if (column === 'TRANSFER_SUBMITTED') {
    note = 'в пути';
  }
  if (column === 'RECEIVED') {
    const statuses = (input.transfers ?? []).map((transfer) => transfer.status);
    note = statuses.includes('RECONCILED') ? 'расхождение согласовано' : null;
  }
  if (column === 'CANCELLED') {
    note = 'перемещение отменено';
  }

  return {
    column,
    note,
    transferId: column === base ? null : (byTransfer?.transferId ?? null),
    cancelledBy: column === 'CANCELLED' ? 'transfer' : null,
  };
}

/** Карточка попадает в колонки перемещений — тогда на неё действует фильтр по складу. */
export function isTransferColumn(column: KanbanColumnKey): boolean {
  return !KANBAN_COLUMN_BY_KEY[column].isOrderColumn && column !== 'CANCELLED';
}
