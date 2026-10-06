// Предупреждение Р-22 (M01 §5 UC-M01-2, BR-13): перед деактивацией позиции НСИ система
// показывает список незавершённых документов, в которых эта позиция используется.
// Деактивация при этом разрешена — предупреждение информирует, а не блокирует.

import type { GoodsTransferStatus, PrismaClient, ProductionOrderStatus } from '@prisma/client';
import { prisma } from './prisma';

export type DeactivatableEntityType =
  | 'WorkCenter'
  | 'Product'
  | 'Employee'
  | 'DefectReason'
  | 'SubstitutionReason'
  | 'Shift';

export interface DeactivationWarning {
  type: 'PRODUCTION_ORDER' | 'GOODS_TRANSFER' | 'SHIFT_SUMMARY';
  id: string;
  label: string;
}

/** Статусы, в которых документ считается незавершённым (00 §3). */
const UNFINISHED_ORDER_STATUSES: ProductionOrderStatus[] = ['DRAFT', 'CONFIRMED', 'IN_PROGRESS'];
const UNFINISHED_TRANSFER_STATUSES: GoodsTransferStatus[] = ['DRAFT', 'SUBMITTED'];

const ORDER_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Черновик',
  CONFIRMED: 'Подтверждено',
  IN_PROGRESS: 'В работе',
};

const TRANSFER_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Черновик',
  SUBMITTED: 'Отправлено',
};

const ORDER_SELECT = { id: true, status: true } as const;

function orderWarning(order: { id: string; status: string }): DeactivationWarning {
  return {
    type: 'PRODUCTION_ORDER',
    id: order.id,
    label: `ПЗ ${order.id.slice(0, 8)} · ${ORDER_STATUS_LABELS[order.status] ?? order.status}`,
  };
}

function transferWarning(transfer: { id: string; status: string }): DeactivationWarning {
  return {
    type: 'GOODS_TRANSFER',
    id: transfer.id,
    label: `Перемещение ${transfer.id.slice(0, 8)} · ${TRANSFER_STATUS_LABELS[transfer.status] ?? transfer.status}`,
  };
}

/**
 * Список незавершённых документов, в которых используется позиция справочника (Р-22).
 *
 * `client` передаётся для тестов; в приложении используется общий клиент Prisma.
 */
export async function getDeactivationWarnings(
  entityType: DeactivatableEntityType,
  entityId: string,
  client: PrismaClient = prisma,
): Promise<DeactivationWarning[]> {
  switch (entityType) {
    case 'WorkCenter': {
      // ПЗ, у которых есть строка на этом РЦ.
      const orders = await client.productionOrder.findMany({
        where: {
          status: { in: UNFINISHED_ORDER_STATUSES },
          lines: { some: { workCenterId: entityId } },
        },
        orderBy: { createdAt: 'desc' },
        select: ORDER_SELECT,
      });
      return orders.map(orderWarning);
    }
    case 'Product': {
      // ПЗ и Перемещения со строками на эту номенклатуру.
      const [orders, transfers] = await Promise.all([
        client.productionOrder.findMany({
          where: {
            status: { in: UNFINISHED_ORDER_STATUSES },
            lines: { some: { productId: entityId } },
          },
          orderBy: { createdAt: 'desc' },
          select: ORDER_SELECT,
        }),
        client.goodsTransfer.findMany({
          where: {
            status: { in: UNFINISHED_TRANSFER_STATUSES },
            lines: { some: { productId: entityId } },
          },
          orderBy: { createdAt: 'desc' },
          select: ORDER_SELECT,
        }),
      ]);
      return [...orders.map(orderWarning), ...transfers.map(transferWarning)];
    }
    case 'Employee': {
      // ПЗ, где сотрудник — Оператор строки или назначенный работник РЦ.
      const orders = await client.productionOrder.findMany({
        where: {
          status: { in: UNFINISHED_ORDER_STATUSES },
          lines: {
            some: {
              OR: [
                { operatorId: entityId },
                { workerAssignments: { some: { employeeId: entityId } } },
              ],
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        select: ORDER_SELECT,
      });
      return orders.map(orderWarning);
    }
    case 'DefectReason': {
      // ПЗ, в факте которых указана эта причина брака.
      const orders = await client.productionOrder.findMany({
        where: {
          status: { in: UNFINISHED_ORDER_STATUSES },
          lines: { some: { facts: { some: { defectReasonId: entityId } } } },
        },
        orderBy: { createdAt: 'desc' },
        select: ORDER_SELECT,
      });
      return orders.map(orderWarning);
    }
    case 'SubstitutionReason': {
      // ПЗ, где итог за Оператора уже внесён с этой причиной (Р-11/Р-13).
      const orders = await client.productionOrder.findMany({
        where: {
          lines: { some: { substitutionReasonId: entityId, status: 'REPORTED' } },
        },
        orderBy: { createdAt: 'desc' },
        select: ORDER_SELECT,
      });
      return orders.map(orderWarning);
    }
    case 'Shift': {
      // ПЗ, привязанные к этой смене.
      const orders = await client.productionOrder.findMany({
        where: { shiftId: entityId, status: { in: UNFINISHED_ORDER_STATUSES } },
        orderBy: { createdAt: 'desc' },
        select: ORDER_SELECT,
      });
      return orders.map(orderWarning);
    }
    default:
      return [];
  }
}
