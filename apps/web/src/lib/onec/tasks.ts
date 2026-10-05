import { Prisma, type TaskForOneCType } from '@prisma/client';
import {
  buildProductionTaskData,
  buildTransferTaskData,
  type OneCTaskData,
} from './task-data';

/**
 * Формирование задач для 1С (T-050, M12 §4.1/§5, Р-24).
 *
 * Одна задача на источник: ПЗ (документ «Производство») или Перемещение (документ «Перемещение»).
 * Синхронизация идемпотентна: повторный вызов на неизменившихся данных не трогает запись,
 * поэтому колонка «последнее изменение» (Р-18) отражает реальное изменение данных (BR-9).
 */

export const ONE_C_SOURCE_TYPES = {
  PRODUCTION: 'PRODUCTION_ORDER',
  TRANSFER: 'GOODS_TRANSFER',
} as const;

export type OneCTaskSyncOutcome = 'created' | 'updated' | 'unchanged' | 'removed' | 'skipped';

export interface SyncTaskForOneCInput {
  type: TaskForOneCType;
  sourceType: string;
  sourceId: string;
  data: OneCTaskData;
}

/**
 * Создаёт или обновляет задачу по её источнику.
 *
 * Задача в статусе «Обработано» не редактируется пользователем (BR-5), но данные всегда
 * соответствуют источнику (BR-9). Если источник изменился уже после отметки «обработано»,
 * задача возвращается в «Ожидает» (решение владельца продукта, 05.10.2026, вариант B):
 * документ в 1С создан по прежним данным, и С1С должен перепроверить его. Причина отмены
 * в этом случае не запрашивается — Р-17 регулирует только ручную отмену.
 */
export async function syncTaskForOneC(
  tx: Prisma.TransactionClient,
  input: SyncTaskForOneCInput,
): Promise<OneCTaskSyncOutcome> {
  const data = input.data as unknown as Prisma.InputJsonValue;

  const existing = await tx.taskForOneC.findUnique({
    where: { type_sourceId: { type: input.type, sourceId: input.sourceId } },
  });

  if (existing) {
    if (existing.sourceType === input.sourceType && JSON.stringify(existing.data) === JSON.stringify(data)) {
      return 'unchanged';
    }

    // BR-5 + BR-9: системное изменение данных снимает отметку «обработано».
    const reopen = existing.status === 'PROCESSED';

    await tx.taskForOneC.update({
      where: { id: existing.id },
      data: {
        sourceType: input.sourceType,
        data,
        ...(reopen ? { status: 'PENDING', processedAt: null, processedById: null } : {}),
      },
    });
    return 'updated';
  }

  await tx.taskForOneC.create({
    data: {
      type: input.type,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      data,
    },
  });
  return 'created';
}

/**
 * Убирает задачу, если источник ещё не готов для 1С (или больше не существует).
 *
 * Задача — системная запись, порождаемая источником: если источник не даёт готовых данных,
 * задачи быть не должно. Пометки С1С при этом не теряются бесследно: и отметка, и её отмена
 * записаны в аудите (Р-17).
 */
async function removeTaskForOneC(
  tx: Prisma.TransactionClient,
  type: TaskForOneCType,
  sourceId: string,
): Promise<OneCTaskSyncOutcome> {
  const existing = await tx.taskForOneC.findUnique({
    where: { type_sourceId: { type, sourceId } },
  });

  if (!existing) {
    return 'skipped';
  }

  await tx.taskForOneC.delete({ where: { id: existing.id } });
  return 'removed';
}

/**
 * Задача типа PRODUCTION по итогу смены (UC-M12-1).
 *
 * Вызывается при завершении ПЗ (итог смены сформирован) и при корректировке факта после
 * закрытия (Р-18), чтобы С1С видел актуальные данные.
 */
export async function syncProductionOrderTask(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<OneCTaskSyncOutcome> {
  const order = await tx.productionOrder.findUnique({
    where: { id: orderId },
    include: {
      shift: true,
      lines: {
        include: {
          workCenter: true,
          product: true,
          facts: {
            include: {
              consumptions: { include: { product: true } },
            },
          },
        },
      },
    },
  });

  if (!order) {
    throw new Error('ПЗ не найдено');
  }

  return syncTaskForOneC(tx, {
    type: 'PRODUCTION',
    sourceType: ONE_C_SOURCE_TYPES.PRODUCTION,
    sourceId: order.id,
    data: buildProductionTaskData(order),
  });
}

/**
 * Статусы Перемещения, в которых данные готовы для 1С.
 *
 * Решение владельца продукта (05.10.2026): С1С обрабатывает только те Перемещения, которые
 * приняла принимающая сторона, — то есть когда обе стороны согласовали итоговое количество.
 * Это `RECEIVED` (принято без расхождений) и `RECONCILED` (расхождение согласовано).
 * Пока Перемещение `DRAFT`/`SUBMITTED`/`DISCREPANCY`, документ «Перемещение» создавать в 1С
 * нельзя: количества ещё не подтверждены принимающей стороной.
 */
export const TRANSFER_READY_STATUSES = ['RECEIVED', 'RECONCILED'] as const;

/**
 * Задача типа TRANSFER по Перемещению (UC-M12-1, BR-3).
 *
 * Вызывается на каждом переходе Перемещения (отправка, приёмка, согласование, отмена):
 * - если Перемещение принято или расхождение согласовано — задача создаётся либо обновляется,
 *   чтобы С1С видел последнюю версию данных (BR-9);
 * - если данные ещё не готовы (черновик, отправлено, расхождение) или Перемещение отменено —
 *   задачи быть не должно, и преждевременно созданная задача убирается.
 */
export async function syncTransferTask(
  tx: Prisma.TransactionClient,
  transferId: string,
): Promise<OneCTaskSyncOutcome> {
  const transfer = await tx.goodsTransfer.findUnique({
    where: { id: transferId },
    include: {
      sourceWarehouse: true,
      destinationWarehouse: true,
      lines: { include: { product: true } },
    },
  });

  if (!transfer) {
    throw new Error('Перемещение не найдено');
  }

  if (!(TRANSFER_READY_STATUSES as readonly string[]).includes(transfer.status)) {
    return removeTaskForOneC(tx, 'TRANSFER', transfer.id);
  }

  return syncTaskForOneC(tx, {
    type: 'TRANSFER',
    sourceType: ONE_C_SOURCE_TYPES.TRANSFER,
    sourceId: transfer.id,
    data: buildTransferTaskData(transfer),
  });
}
