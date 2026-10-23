'use server';

import { revalidatePath } from 'next/cache';
import { Prisma, type TaskForOneCType } from '@prisma/client';
import { prisma, writeAudit } from '@prodtrack/db';
import { requirePermission } from '@/lib/auth/access';
import { syncProductionOrderTask, syncTransferTask } from '@/lib/onec/tasks';

/**
 * Действия рабочего места С1С (T-052, M12 §5 UC-M12-2/UC-M12-3, BR-4/BR-5/BR-8).
 *
 * Отметку «обработано» и её отмену ставит только С1С — право `onec:process` (00 §4.2).
 * Каждая отмена фиксируется в аудите (Р-17); отмена обязательна с причиной.
 */

export type OneCTaskActionResult =
  | { success: true }
  | { success: false; error: string };

export interface OneCTaskActionDeps {
  prisma: typeof prisma;
  writeAudit: typeof writeAudit;
  requirePermission: typeof requirePermission;
}

/**
 * Отметка «обработано» (BR-4, UC-M12-2).
 *
 * Меняет только статус задачи: отметка информационная и другие модули не затрагивает (BR-8).
 */
/** Снимок проведённого: id фактов производства на момент отметки (ОПЭ-36). */
async function buildProcessedScope(
  client: typeof prisma,
  type: TaskForOneCType,
  sourceId: string,
): Promise<Prisma.InputJsonValue | undefined> {
  if (type !== 'PRODUCTION') {
    return undefined;
  }
  const facts = await client.productionFact.findMany({
    where: { line: { orderId: sourceId } },
    select: { id: true },
  });
  return { factIds: facts.map((fact) => fact.id) };
}

export async function markTaskProcessed(
  taskId: string,
  deps: OneCTaskActionDeps = { prisma, writeAudit, requirePermission },
): Promise<void> {
  const session = await deps.requirePermission('onec:process');
  const roles = session.user.roles.map((ur) => ur.role.code);

  const task = await deps.prisma.taskForOneC.findUnique({ where: { id: taskId } });
  if (!task) {
    throw new Error('Задача не найдена');
  }
  if (task.status === 'PROCESSED') {
    throw new Error('Задача уже отмечена как обработанная');
  }

  const processedAt = new Date();

  // ОПЭ-36: сохраняем снимок того, что проведено, — по нему из задачи исключается уже
  // проведённое, когда появятся новые данные (например, отчёт по второму РЦ).
  const processedScope = await buildProcessedScope(deps.prisma, task.type, task.sourceId);

  await deps.prisma.$transaction(async (tx) => {
    // Вариант B (решение владельца 06.10.2026): отметка не меняет «последнее изменение» —
    // это время изменения данных источника (BR-9), а не действие над задачей.
    await tx.taskForOneC.update({
      where: { id: taskId },
      data: { status: 'PROCESSED', processedAt, processedById: session.userId, processedScope },
    });

    await deps.writeAudit(tx, {
      action: 'UPDATE',
      objectType: 'TaskForOneC',
      objectId: taskId,
      field: 'status',
      oldValue: task.status,
      newValue: 'PROCESSED',
      userId: session.userId,
      userRoles: roles,
      permission: 'onec:process',
    });
  });

  revalidatePath('/onec');
  revalidatePath('/onec/' + taskId);
}

/**
 * Отмена отметки «обработано» (Р-17, BR-8, UC-M12-3).
 *
 * Обязательна причина; отмена переводит задачу в «Ожидает» и фиксируется в аудите.
 */
export async function unmarkTaskProcessed(
  taskId: string,
  input: { reason: string },
  deps: OneCTaskActionDeps = { prisma, writeAudit, requirePermission },
): Promise<void> {
  const session = await deps.requirePermission('onec:process');
  const roles = session.user.roles.map((ur) => ur.role.code);

  const reason = (input.reason ?? '').trim();
  if (reason.length === 0) {
    throw new Error('Причина отмены обязательна (Р-17)');
  }

  const task = await deps.prisma.taskForOneC.findUnique({ where: { id: taskId } });
  if (!task) {
    throw new Error('Задача не найдена');
  }
  if (task.status !== 'PROCESSED') {
    throw new Error('Задача не отмечена как обработанная');
  }

  await deps.prisma.$transaction(async (tx) => {
    // Отмена отметки также не трогает «последнее изменение» (вариант B).
    await tx.taskForOneC.update({
      where: { id: taskId },
      // ОПЭ-36: снимаем снимок — проведённое снова становится данными задачи.
      data: { status: 'PENDING', processedAt: null, processedById: null, processedScope: Prisma.DbNull },
    });

    // И пересобираем данные из источника, чтобы проведённое вернулось в задачу.
    // Источника может уже не быть — тогда пересобирать нечего, отметка всё равно снята.
    try {
      if (task.type === 'PRODUCTION') {
        await syncProductionOrderTask(tx, task.sourceId);
      } else {
        await syncTransferTask(tx, task.sourceId);
      }
    } catch {
      // источник недоступен: данные задачи останутся прежними
    }

    // Р-09/Р-17: смена статуса и причина отмены — отдельными записями аудита.
    await deps.writeAudit(tx, {
      action: 'CANCEL',
      objectType: 'TaskForOneC',
      objectId: taskId,
      field: 'status',
      oldValue: 'PROCESSED',
      newValue: 'PENDING',
      userId: session.userId,
      userRoles: roles,
      permission: 'onec:process',
    });

    await deps.writeAudit(tx, {
      action: 'CANCEL',
      objectType: 'TaskForOneC',
      objectId: taskId,
      field: 'reason',
      newValue: reason,
      userId: session.userId,
      userRoles: roles,
      permission: 'onec:process',
    });
  });

  revalidatePath('/onec');
  revalidatePath('/onec/' + taskId);
}

export async function markTaskProcessedAction(taskId: string): Promise<OneCTaskActionResult> {
  try {
    await markTaskProcessed(taskId);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Не удалось отметить задачу обработанной',
    };
  }
}

export async function unmarkTaskProcessedAction(
  taskId: string,
  formData: FormData,
): Promise<OneCTaskActionResult> {
  try {
    const reason = formData.get('reason')?.toString() ?? '';
    await unmarkTaskProcessed(taskId, { reason });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Не удалось отменить обработку задачи',
    };
  }
}
