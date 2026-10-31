import type { PrismaClient } from '@prisma/client';
import { hasPermission } from '@prodtrack/contracts';
import { resolveCurrentShift, shiftWindowBounds, type ShiftWindow } from './current-shift';
import {
  KANBAN_COLUMNS,
  KANBAN_COLUMN_BY_KEY,
  resolveKanbanStage,
  type KanbanColumn,
  type KanbanColumnKey,
} from './stage';
import {
  resolveTransferColumn,
  shiftWindow,
  transferEventDate,
  transferNote,
  type TransferDates,
} from './transfer-stage';

/**
 * Данные доски контура (T-103, постановка `docs/kanban_design.md` §13.4).
 *
 * Карточка — строка РЦ. Этап считает чистая функция (`stage.ts`), здесь только сбор данных,
 * фильтры и то, что видно роли по правам. Один запрос строк + один запрос задач 1С.
 */

/**
 * Тон плашки — **цвет**, а не смысл (решение владельца 31.10.2026): «ожидает 1С»
 * и «расхождение» — розовый, «проведено» и «расхождение согласовано» — салатовый,
 * «в пути» — светло-песочный. Значение приходит из данных вместе с пометкой,
 * разметка по нему только выбирает класс из токенов темы.
 */
export type NoteTone = 'rose' | 'mint' | 'sand' | 'neutral';

export interface KanbanLineCard {
  kind: 'line';
  lineId: string;
  orderId: string;
  /** Короткий идентификатор ПЗ для подписи карточки. */
  orderLabel: string;
  shiftId: string;
  shiftLabel: string;
  workCenterCode: string;
  workCenterName: string;
  /** Идентификатор номенклатуры строки — по нему фильтр и список опций. */
  productId: string;
  /** Идентификатор РЦ строки — по нему фильтр и список опций. */
  workCenterId: string;
  productCode: string;
  productName: string;
  productUnit: string;
  plan: number;
  /** Сумма фактов по строке (Масса + ГФ + ПФ) — для подписи «план / факт». */
  fact: number;
  operatorName: string | null;
  column: KanbanColumnKey;
  note: string | null;
  /**
   * Тон плашки: цвет выбирает разметка по этому полю, а не по тексту (ОПЭ-74).
   * Значение вычисляется здесь, вместе с этапом.
   */
  noteTone: NoteTone;
  /** Чем вызвана колонка «Отменено» — от этого зависит видимость складским ролям. */
  cancelledBy: 'order' | null;
  /** Куда ведёт клик: экран действия, а не изменение статуса (решение владельца). */
  href: string;
}

/**
 * Самостоятельная карточка перемещения (решение владельца 31.10.2026).
 *
 * Колонки 6–9 больше не строятся из строк ПЗ: привязки к строке нет, отбор — по дате документа
 * в окне выбранной смены. Поэтому у карточки своя дата, свои склады и своя номенклатура.
 */
export interface KanbanTransferCard {
  kind: 'transfer';
  transferId: string;
  column: KanbanColumnKey;
  note: string | null;
  noteTone: NoteTone;
  cancelledBy: 'transfer' | null;
  /** Номенклатура перемещения (показываем первую строку). */
  productCode: string;
  productName: string;
  productUnit: string;
  /** Все номенклатуры документа: по ним работает фильтр и список опций. */
  productIds: string[];
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  /**
   * Количество на карточке: **принятое**, если приёмка была (`RECEIVED`, `RECONCILED`,
   * `DISCREPANCY`), иначе плановое (ОПЭ-75). Раньше здесь всегда был план — после согласования
   * расхождения карточка показывала количество ДО согласования.
   */
  quantity: number;
  /** Плановое количество (сумма по строкам) — показывается рядом, когда отличается. */
  plannedQuantity: number;
  /** Разница «принято − план»; null — приёмки ещё не было. */
  difference: number | null;
  sourceWarehouseName: string;
  destinationWarehouseName: string;
  /** Дата, по которой перемещение попало в смену. */
  eventDate: Date;
  href: string;
}

export type KanbanCard = KanbanLineCard | KanbanTransferCard;

export interface KanbanBoardFilter {
  shiftId?: string;
  workCenterId?: string;
  productId?: string;
  warehouseId?: string;
}

export interface KanbanBoard {
  cards: KanbanCard[];
  /** Смена, за которую построена доска; null — смен нет вовсе. */
  shift: { id: string; label: string } | null;
  /**
   * Сколько ДРУГИХ смен имеют привязанные перемещения.
   *
   * Доска — срез по выбранной смене, поэтому перемещение, привязанное к строке другой смены,
   * в текущем срезе не появится. Это правило, а не ловушка: экран подсказывает, что данные
   * есть и где их искать (ОПЭ-74, дефект 1 — сценарий владельца упал именно на этом).
   */
  otherShiftsWithTransfers: number;
  /**
   * Опции фильтров — **из карточек доски**, а не из каталога (замечание владельца 01.11.2026).
   *
   * Каждый список считается при всех применённых фильтрах, **кроме своего**: иначе, выбрав
   * одну номенклатуру, пользователь увидел бы в списке только её и не смог бы выбрать другую.
   */
  options: KanbanFilterOptions;
}

export interface KanbanFilterOption {
  id: string;
  label: string;
}

export interface KanbanFilterOptions {
  products: KanbanFilterOption[];
  workCenters: KanbanFilterOption[];
  warehouses: KanbanFilterOption[];
  /**
   * Выбранные значения, которых на доске больше нет. Экран не подменяет фильтр молча:
   * он оставляет значение в списке и подсказывает, что его нет (иначе это ложь в интерфейсе).
   */
  missingSelection: {
    product: boolean;
    workCenter: boolean;
    warehouse: boolean;
  };
}

interface LineRow {
  id: string;
  productId: string;
  workCenterId: string;
  plannedQuantity: { toString(): string };
  status: string;
  operator: { fullName: string } | null;
  workCenter: { code: string; name: string };
  product: { code: string; name: string; unit: string };
  facts: Array<{ factCategory: string; quantity: { toString(): string } }>;
  order: { id: string; status: string; shiftId: string };
}

function toNumber(value: { toString(): string }): number {
  return Number(value.toString());
}

function shiftLabelOf(shift: ShiftWindow): string {
  return `Смена ${shift.number} от ${shift.date.toLocaleDateString('ru-RU')}`;
}

/**
 * Доска за смену. Смена по умолчанию — текущая (решение владельца): она вычисляется
 * с учётом перехода через полночь, а не «дата = сегодня».
 */
export async function getKanbanBoard(
  client: Pick<PrismaClient, 'shift' | 'productionOrderLine' | 'taskForOneC' | 'goodsTransfer'>,
  filter: KanbanBoardFilter,
  options: { now?: Date } = {},
): Promise<KanbanBoard> {
  const shifts = (await client.shift.findMany({
    orderBy: [{ date: 'desc' }, { number: 'desc' }],
  })) as ShiftWindow[];

  const shift = filter.shiftId
    ? (shifts.find((item) => item.id === filter.shiftId) ?? null)
    : resolveCurrentShift(shifts, options.now ?? new Date());

  if (!shift) {
    return {
      cards: [],
      shift: null,
      otherShiftsWithTransfers: 0,
      options: {
        products: [],
        workCenters: [],
        warehouses: [],
        missingSelection: { product: false, workCenter: false, warehouse: false },
      },
    };
  }

  const lines = (await client.productionOrderLine.findMany({
    // Только смена: фильтры применяются ниже, в памяти (см. `applyBoardFilter`). Если резать
    // выборку в запросе, из неё уже не построить список опций «при всех фильтрах, кроме своего».
    where: { order: { shiftId: shift.id } },
    include: {
      order: { select: { id: true, status: true, shiftId: true } },
      workCenter: { select: { code: true, name: true } },
      product: { select: { code: true, name: true, unit: true } },
      operator: { select: { fullName: true } },
      facts: { select: { factCategory: true, quantity: true } },
    },
  })) as LineRow[];

  const orderIds = [...new Set(lines.map((line) => line.order.id))];
  const tasks =
    orderIds.length > 0
      ? ((await client.taskForOneC.findMany({
          where: { type: 'PRODUCTION', sourceId: { in: orderIds } },
          select: { sourceId: true, status: true },
        })) as Array<{ sourceId: string; status: string }>)
      : [];
  const taskStatusByOrder = new Map(tasks.map((task) => [task.sourceId, task.status]));

  const cards: KanbanCard[] = [];

  for (const line of lines) {
    const stage = resolveKanbanStage({
      orderStatus: line.order.status,
      lineStatus: line.status,
      oneCTaskStatus: taskStatusByOrder.get(line.order.id) ?? null,
    });

    cards.push({
      kind: 'line',
      lineId: line.id,
      orderId: line.order.id,
      orderLabel: `ПЗ ${line.order.id.slice(0, 8)}`,
      shiftId: shift.id,
      shiftLabel: shiftLabelOf(shift),
      productId: line.productId,
      workCenterId: line.workCenterId,
      workCenterCode: line.workCenter.code,
      workCenterName: line.workCenter.name,
      productCode: line.product.code,
      productName: line.product.name,
      productUnit: line.product.unit,
      plan: toNumber(line.plannedQuantity),
      fact: line.facts.reduce((sum, fact) => sum + toNumber(fact.quantity), 0),
      operatorName: line.operator?.fullName ?? null,
      column: stage.column,
      note: stage.note,
      noteTone: lineNoteTone(stage.column, stage.note),
      cancelledBy: stage.cancelledBy === 'order' ? 'order' : null,
      // Клик ведёт на экран действия: доска ничего не меняет (решение владельца).
      href:
        stage.column === 'CANCELLED'
          ? `/production-orders/${line.order.id}`
          : `/production-orders/${line.order.id}#line-${line.id}`,
    });
  }

  // Колонки 6–9: самостоятельные перемещения, отбор по дате документа в окне смены.
  const window = shiftWindow(shift);
  const allTransfers = (await client.goodsTransfer.findMany({
    where: { status: { in: ['DRAFT', 'SUBMITTED', 'RECEIVED', 'RECONCILED', 'DISCREPANCY', 'CANCELLED'] } },
    orderBy: { createdAt: 'desc' },
    take: 500,
    select: {
      id: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      submittedAt: true,
      sourceWarehouse: { select: { id: true, name: true } },
      destinationWarehouse: { select: { id: true, name: true } },
      lines: {
        select: {
          product: { select: { id: true, code: true, name: true, unit: true } },
          plannedQuantity: true,
          actualQuantity: true,
          discrepancies: { select: { actualQuantity: true, difference: true } },
        },
      },
    },
  })) as Array<
    TransferDates & {
      id: string;
      sourceWarehouse: { id: string; name: string };
      destinationWarehouse: { id: string; name: string };
      lines: Array<{
        product: { id: string; code: string; name: string; unit: string };
        plannedQuantity: { toString(): string };
        actualQuantity: { toString(): string } | null;
        discrepancies: Array<{
          actualQuantity: { toString(): string };
          difference: { toString(): string };
        }>;
      }>;
    }
  >;

  const transferCards: KanbanTransferCard[] = [];

  for (const transfer of allTransfers) {
    // Фильтр по складу действует только на перемещения — строки РЦ склада не имеют.
    if (
      filter.warehouseId &&
      transfer.sourceWarehouse.id !== filter.warehouseId &&
      transfer.destinationWarehouse.id !== filter.warehouseId
    ) {
      continue;
    }

    const column = window ? resolveTransferColumn(transfer, window) : null;
    if (!column) {
      continue;
    }

    // ОПЭ-75: после приёмки показываем ПРИНЯТОЕ количество, а не план. Если по строке
    // фактического количества нет (черновик, отправлено), остаётся план.
    const plannedQuantity = transfer.lines.reduce((sum, line) => sum + toNumber(line.plannedQuantity), 0);
    const accepted = transfer.lines.reduce(
      (sum, line) => sum + toNumber(line.actualQuantity ?? line.plannedQuantity),
      0,
    );
    const isAccepted = ACCEPTED_TRANSFER_STATUSES.has(transfer.status);
    const quantity = isAccepted ? accepted : plannedQuantity;
    // Разница — из записи расхождения, если она есть (там она посчитана при приёмке),
    // иначе как арифметика двух количеств.
    const storedDifference = transfer.lines.reduce((sum, line) => {
      const discrepancy = line.discrepancies[0];
      return discrepancy ? sum + toNumber(discrepancy.difference) : sum;
    }, 0);
    const difference = isAccepted ? roundQuantity(storedDifference || quantity - plannedQuantity) : null;
    const first = transfer.lines[0];

    transferCards.push({
      kind: 'transfer',
      transferId: transfer.id,
      column,
      note: transferNote(transfer),
      noteTone: transferNoteTone(transfer.status),
      cancelledBy: column === 'CANCELLED' ? 'transfer' : null,
      productCode: first?.product.code ?? '—',
      productName: first?.product.name ?? 'Номенклатура не указана',
      productUnit: first?.product.unit ?? '',
      // Фильтр по номенклатуре смотрит ВСЕ строки документа, а на карточке видна первая.
      productIds: [...new Set(transfer.lines.map((line) => line.product.id))],
      sourceWarehouseId: transfer.sourceWarehouse.id,
      destinationWarehouseId: transfer.destinationWarehouse.id,
      quantity: roundQuantity(quantity),
      plannedQuantity: roundQuantity(plannedQuantity),
      difference,
      sourceWarehouseName: transfer.sourceWarehouse.name,
      destinationWarehouseName: transfer.destinationWarehouse.name,
      eventDate: transferEventDate(transfer),
      // Клик ведёт на экран перемещения: доска ничего не меняет.
      href: `/transfers/${transfer.id}`,
    });
  }

  transferCards.sort((a, b) => b.eventDate.getTime() - a.eventDate.getTime());

  const allCards: KanbanCard[] = [...cards, ...transferCards];

  const hasTransferCards = transferCards.some((card) =>
    applyBoardFilter([card], filter).length > 0,
  );
  const otherShiftsWithTransfers = hasTransferCards
    ? 0
    : countOtherShiftsWithTransfers(allTransfers, shifts, shift.id);

  return {
    cards: applyBoardFilter(allCards, filter),
    shift: { id: shift.id, label: shiftLabelOf(shift) },
    otherShiftsWithTransfers,
    options: buildFilterOptions(allCards, filter),
  };
}

/** Карточка подходит под фильтр по одному измерению. */
function matchesDimension(card: KanbanCard, dimension: 'workCenterId' | 'productId' | 'warehouseId', value: string | undefined): boolean {
  if (!value) {
    return true;
  }
  if (dimension === 'productId') {
    return card.kind === 'line' ? card.productId === value : card.productIds.includes(value);
  }
  if (dimension === 'workCenterId') {
    // У перемещения своего РЦ нет — фильтр по РЦ его не касается (карточку не скрываем).
    return card.kind === 'line' ? card.workCenterId === value : true;
  }
  // Склад относится только к перемещениям: строку РЦ фильтр по складу не скрывает
  // (решение владельца 30.10.2026 — склад фильтрует только колонки перемещений).
  return card.kind === 'transfer'
    ? card.sourceWarehouseId === value || card.destinationWarehouseId === value
    : true;
}

/** Фильтрация доски: раньше резалась в запросе, теперь в памяти — из тех же карточек. */
export function applyBoardFilter(cards: KanbanCard[], filter: KanbanBoardFilter): KanbanCard[] {
  return cards.filter(
    (card) =>
      matchesDimension(card, 'workCenterId', filter.workCenterId) &&
      matchesDimension(card, 'productId', filter.productId) &&
      matchesDimension(card, 'warehouseId', filter.warehouseId),
  );
}

/**
 * Списки опций фильтров — из карточек доски, каждое при всех фильтрах, **кроме своего**
 * (замечание владельца 01.11.2026). Иначе выбранная номенклатура осталась бы единственной
 * опцией в своём же списке, и сменить её было бы нельзя.
 */
export function buildFilterOptions(
  cards: KanbanCard[],
  filter: KanbanBoardFilter,
): KanbanFilterOptions {
  const withoutProduct = cards.filter(
    (card) =>
      matchesDimension(card, 'workCenterId', filter.workCenterId) &&
      matchesDimension(card, 'warehouseId', filter.warehouseId),
  );
  const withoutWorkCenter = cards.filter(
    (card) =>
      matchesDimension(card, 'productId', filter.productId) &&
      matchesDimension(card, 'warehouseId', filter.warehouseId),
  );
  const withoutWarehouse = cards.filter(
    (card) =>
      matchesDimension(card, 'workCenterId', filter.workCenterId) &&
      matchesDimension(card, 'productId', filter.productId),
  );

  const products = new Map<string, string>();
  const workCenters = new Map<string, string>();
  const warehouses = new Map<string, string>();

  for (const card of withoutProduct) {
    if (card.kind === 'line') {
      products.set(card.productId, `${card.productCode} — ${card.productName}`);
    } else {
      for (const id of card.productIds) {
        products.set(id, card.productName ? `${card.productCode} — ${card.productName}` : id);
      }
    }
  }

  for (const card of withoutWorkCenter) {
    if (card.kind === 'line') {
      workCenters.set(card.workCenterId, `${card.workCenterCode} — ${card.workCenterName}`);
    }
  }

  for (const card of withoutWarehouse) {
    if (card.kind === 'transfer') {
      warehouses.set(card.sourceWarehouseId, card.sourceWarehouseName);
      warehouses.set(card.destinationWarehouseId, card.destinationWarehouseName);
    }
  }

  const sorted = (map: Map<string, string>): KanbanFilterOption[] =>
    [...map.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ru'));

  return {
    products: sorted(products),
    workCenters: sorted(workCenters),
    warehouses: sorted(warehouses),
    missingSelection: {
      product: Boolean(filter.productId) && !products.has(filter.productId!),
      workCenter: Boolean(filter.workCenterId) && !workCenters.has(filter.workCenterId!),
      warehouse: Boolean(filter.warehouseId) && !warehouses.has(filter.warehouseId!),
    },
  };
}

/** Тон плашки строки: «проведено» — салатовый, «ожидает 1С» — розовый, иначе нейтральный. */
export function lineNoteTone(column: string, note: string | null): NoteTone {
  if (column !== 'CLOSED') {
    return 'neutral';
  }
  return note === 'проведено' ? 'mint' : 'rose';
}

/** Тон плашки перемещения по статусу — из данных, а не из текста пометки. */
export function transferNoteTone(status: string): NoteTone {
  if (status === 'SUBMITTED') {
    return 'sand';
  }
  if (status === 'DISCREPANCY') {
    return 'rose';
  }
  if (status === 'RECONCILED') {
    return 'mint';
  }
  return 'neutral';
}

/** Статусы, в которых фактическое количество уже есть (ОПЭ-75). */
const ACCEPTED_TRANSFER_STATUSES = new Set(['RECEIVED', 'RECONCILED', 'DISCREPANCY']);

function roundQuantity(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Сколько ДРУГИХ смен содержат перемещения по дате документа.
 *
 * Считается по самим перемещениям (привязки к строке ПЗ больше нет): для каждого перемещения
 * берём его дату и ищем смену, в чьё окно она попадает. Нужно только для подсказки, поэтому
 * вызывается лишь когда в выбранной смене перемещений нет.
 */
function countOtherShiftsWithTransfers(
  transfers: TransferDates[],
  shifts: ShiftWindow[],
  currentShiftId: string,
): number {
  const windows = shifts
    .filter((item) => item.id !== currentShiftId)
    .map((item) => ({ id: item.id, window: shiftWindow(item) }))
    .filter((item): item is { id: string; window: { from: Date; to: Date } } => item.window !== null);

  const found = new Set<string>();
  for (const transfer of transfers) {
    const date = transferEventDate(transfer);
    for (const item of windows) {
      if (date >= item.window.from && date <= item.window.to) {
        found.add(item.id);
        break;
      }
    }
  }
  return found.size;
}

/**
 * Колонки, которые видит роль.
 *
 * Складским ролям (КСГП, УСГП) колонки ПЗ не рендерятся: у них нет `production_order:read`,
 * и пустая колонка читалась бы как «здесь ничего не происходит» (решение владельца).
 */
export function visibleKanbanColumns(roles: string[]): KanbanColumn[] {
  if (hasPermission(roles, 'production_order:read')) {
    return KANBAN_COLUMNS;
  }
  return KANBAN_COLUMNS.filter((column) => !column.isOrderColumn);
}

/**
 * Карточки, которые роль имеет право видеть.
 *
 * Кроме колонок учитывается причина отмены: отменённое **перемещение** — данные склада,
 * а отменённое **ПЗ** — данные ПЗ, и складской роли его карточка не показывается.
 */
export function filterKanbanCardsForRoles(cards: KanbanCard[], roles: string[]): KanbanCard[] {
  const columns = new Set(visibleKanbanColumns(roles).map((column) => column.key));
  const canSeeOrderData = hasPermission(roles, 'production_order:read');

  return cards.filter((card) => {
    // Карточки перемещений видны всем, у кого есть доска: их колонки (6–9 и «Отменено»
    // для перемещений) есть и у складских ролей.
    if (!columns.has(card.column)) {
      return false;
    }
    // Отменённое ПЗ — данные ПЗ, складским ролям не показывается.
    if (!canSeeOrderData && card.kind === 'line' && card.cancelledBy === 'order') {
      return false;
    }
    return true;
  });
}

export { KANBAN_COLUMN_BY_KEY, shiftWindowBounds };
