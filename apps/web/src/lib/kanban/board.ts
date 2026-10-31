import type { PrismaClient } from '@prisma/client';
import { hasPermission } from '@prodtrack/contracts';
import { resolveCurrentShift, shiftWindowBounds, type ShiftWindow } from './current-shift';
import {
  KANBAN_COLUMNS,
  KANBAN_COLUMN_BY_KEY,
  isTransferColumn,
  resolveKanbanStage,
  type KanbanColumn,
  type KanbanColumnKey,
} from './stage';

/**
 * Данные доски контура (T-103, постановка `docs/kanban_design.md` §13.4).
 *
 * Карточка — строка РЦ. Этап считает чистая функция (`stage.ts`), здесь только сбор данных,
 * фильтры и то, что видно роли по правам. Один запрос строк + один запрос задач 1С.
 */

export interface KanbanCard {
  lineId: string;
  orderId: string;
  /** Короткий идентификатор ПЗ для подписи карточки. */
  orderLabel: string;
  shiftId: string;
  shiftLabel: string;
  workCenterCode: string;
  workCenterName: string;
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
   * Тон метки: цвет выбирает разметка по этому полю, а не по тексту (ОПЭ-74).
   * Значение вычисляется здесь, вместе с этапом.
   */
  noteTone: 'pending' | 'done' | 'neutral';
  /** Перемещение, по которому карточка стоит в колонках 6–9. */
  transferId: string | null;
  /** Чем вызвана колонка «Отменено» — от этого зависит видимость складским ролям. */
  cancelledBy: 'order' | 'transfer' | null;
  /** Куда ведёт клик: экран действия, а не изменение статуса (решение владельца). */
  href: string;
}

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
}

interface LineRow {
  id: string;
  plannedQuantity: { toString(): string };
  status: string;
  operator: { fullName: string } | null;
  workCenter: { code: string; name: string };
  product: { code: string; name: string; unit: string };
  facts: Array<{ factCategory: string; quantity: { toString(): string } }>;
  order: { id: string; status: string; shiftId: string };
  transferLines: Array<{
    id: string;
    goodsTransfer: {
      id: string;
      status: string;
      sourceWarehouseId: string;
      destinationWarehouseId: string;
    };
  }>;
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
  client: Pick<PrismaClient, 'shift' | 'productionOrderLine' | 'taskForOneC'>,
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
    return { cards: [], shift: null };
  }

  const lines = (await client.productionOrderLine.findMany({
    where: {
      order: { shiftId: shift.id },
      ...(filter.workCenterId ? { workCenterId: filter.workCenterId } : {}),
      ...(filter.productId ? { productId: filter.productId } : {}),
    },
    include: {
      order: { select: { id: true, status: true, shiftId: true } },
      workCenter: { select: { code: true, name: true } },
      product: { select: { code: true, name: true, unit: true } },
      operator: { select: { fullName: true } },
      facts: { select: { factCategory: true, quantity: true } },
      transferLines: {
        select: {
          id: true,
          goodsTransfer: {
            select: {
              id: true,
              status: true,
              sourceWarehouseId: true,
              destinationWarehouseId: true,
            },
          },
        },
      },
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
    const transfers = line.transferLines.map((transferLine) => transferLine.goodsTransfer);
    const stage = resolveKanbanStage({
      orderStatus: line.order.status,
      lineStatus: line.status,
      oneCTaskStatus: taskStatusByOrder.get(line.order.id) ?? null,
      transfers,
    });

    // Фильтр по складу действует только на колонки перемещений: у строки РЦ своего склада нет,
    // поэтому карточки в колонках ПЗ он не скрывает (решение владельца 30.10.2026).
    if (filter.warehouseId && isTransferColumn(stage.column)) {
      const involvesWarehouse = transfers.some(
        (transfer) =>
          transfer.status !== 'CANCELLED' &&
          (transfer.sourceWarehouseId === filter.warehouseId ||
            transfer.destinationWarehouseId === filter.warehouseId),
      );
      if (!involvesWarehouse) {
        continue;
      }
    }

    cards.push({
      lineId: line.id,
      orderId: line.order.id,
      orderLabel: `ПЗ ${line.order.id.slice(0, 8)}`,
      shiftId: shift.id,
      shiftLabel: shiftLabelOf(shift),
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
      noteTone:
        stage.column === 'CLOSED' && stage.note === 'проведено'
          ? 'done'
          : stage.column === 'CLOSED'
            ? 'pending'
            : 'neutral',
      transferId: stage.transferId,
      cancelledBy: stage.cancelledBy,
      // Клик ведёт на экран действия: доска ничего не меняет (решение владельца).
      href:
        stage.column === 'CANCELLED' && stage.cancelledBy === 'order'
          ? `/production-orders/${line.order.id}`
          : stage.transferId
            ? `/transfers/${stage.transferId}`
            : `/production-orders/${line.order.id}#line-${line.id}`,
    });
  }

  return { cards, shift: { id: shift.id, label: shiftLabelOf(shift) } };
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
    if (!columns.has(card.column)) {
      return false;
    }
    if (!canSeeOrderData && card.cancelledBy === 'order') {
      return false;
    }
    return true;
  });
}

export { KANBAN_COLUMN_BY_KEY, shiftWindowBounds };
