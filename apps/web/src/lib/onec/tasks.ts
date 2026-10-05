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

export type OneCTaskSyncOutcome = 'created' | 'updated' | 'unchanged';

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
 * соответствуют источнику (BR-9): обновление выполняется только системой и только тогда,
 * когда набор данных действительно изменился.
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

    await tx.taskForOneC.update({
      where: { id: existing.id },
      data: { sourceType: input.sourceType, data },
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
 * Задача типа TRANSFER по Перемещению (UC-M12-1, BR-3).
 *
 * Вызывается при отправке, приёмке, согласовании расхождений и отмене Перемещения — данные
 * задачи всегда отражают последнюю версию документа (BR-9).
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

  return syncTaskForOneC(tx, {
    type: 'TRANSFER',
    sourceType: ONE_C_SOURCE_TYPES.TRANSFER,
    sourceId: transfer.id,
    data: buildTransferTaskData(transfer),
  });
}
