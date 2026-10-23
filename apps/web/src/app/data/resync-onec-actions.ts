'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@prodtrack/db';
import { requirePermission } from '@/lib/auth/access';
import { syncProductionOrderTask, syncTransferTask } from '@/lib/onec/tasks';

/**
 * Пересобирает данные задач для 1С из их источников (ОПЭ-35).
 *
 * Зачем: данные задачи хранятся в JSON, собранном в момент синхронизации. Когда в состав данных
 * добавляется поле (например, категория остатка в потреблении), у уже существующих задач его нет —
 * и экран показывает пустую колонку. Пересборка обновляет JSON из ПЗ и Перемещений, ничего
 * не создавая и не удаляя: состав задач остаётся тем же.
 *
 * Идемпотентно: повторный запуск ничего не меняет, если данные источника не менялись.
 */
export async function resyncOneCTaskDataAction(): Promise<{ success: boolean; updated?: number; error?: string }> {
  try {
    await requirePermission('onec:process');

    const tasks = await prisma.taskForOneC.findMany({
      select: { id: true, type: true, sourceId: true },
    });

    let updated = 0;
    for (const task of tasks) {
      await prisma.$transaction(async (tx) => {
        const outcome =
          task.type === 'PRODUCTION'
            ? await syncProductionOrderTask(tx, task.sourceId)
            : await syncTransferTask(tx, task.sourceId);
        if (outcome === 'updated' || outcome === 'created') {
          updated += 1;
        }
      });
    }

    revalidatePath('/onec');
    revalidatePath('/data');
    return { success: true, updated };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось пересобрать данные задач 1С';
    return { success: false, error: message };
  }
}
