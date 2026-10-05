'use server';

import { revalidatePath } from 'next/cache';
import { prisma, writeAudit } from '@prodtrack/db';
import { requirePermission } from '@/lib/auth/access';

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

  await deps.prisma.$transaction(async (tx) => {
    await tx.taskForOneC.update({
      where: { id: taskId },
      data: { status: 'PROCESSED', processedAt, processedById: session.userId },
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
    await tx.taskForOneC.update({
      where: { id: taskId },
      data: { status: 'PENDING', processedAt: null, processedById: null },
    });

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
