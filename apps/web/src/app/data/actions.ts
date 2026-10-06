'use server';

import { revalidatePath } from 'next/cache';
import { prisma, writeAudit } from '@prodtrack/db';
import { requireSession } from '@/lib/auth/session';
import { CLEAR_CONFIRMATION_WORD, findDataGroups } from '@/lib/data-cleanup';

export interface ClearDataResult {
  success: boolean;
  error?: string;
  removed?: { key: string; label: string; records: number }[];
}

/**
 * Очистка выбранных групп операционных данных (T-076).
 *
 * Доступ — только администратору. Подтверждение вводится словом, чтобы очистка не сработала
 * случайным кликом. Удаление идёт в порядке зависимостей, а сам факт очистки дописывается
 * в журнал аудита: он ведётся append-only и не чистится (M13 BR-1).
 */
export async function clearDataAction(
  keys: string[],
  confirmation: string,
): Promise<ClearDataResult> {
  try {
    const session = await requireSession();
    const roles = session.user.roles.map((ur) => ur.role.code);
    if (!roles.includes('ADM')) {
      return { success: false, error: 'Очистка данных доступна только администратору' };
    }
    if (confirmation.trim().toUpperCase() !== CLEAR_CONFIRMATION_WORD) {
      return { success: false, error: 'Введите слово ' + CLEAR_CONFIRMATION_WORD + ' для подтверждения' };
    }

    const groups = findDataGroups(keys);
    if (groups.length === 0) {
      return { success: false, error: 'Выберите хотя бы одну группу данных' };
    }

    const removed = await prisma.$transaction(async (tx) => {
      const result: { key: string; label: string; records: number }[] = [];
      for (const group of groups) {
        result.push({ key: group.key, label: group.label, records: await group.remove(tx) });
      }

      await writeAudit(tx, {
        action: 'DELETE',
        objectType: 'DataCleanup',
        objectId: 'data-cleanup',
        userId: session.userId,
        // Роль атрибутируется напрямую: экран доступен только администратору.
        role: 'ADM',
        newValue: JSON.stringify({
          groups: result,
          total: result.reduce((sum, item) => sum + item.records, 0),
        }),
      });

      return result;
    });

    for (const path of ['/data', '/dashboard', '/production-orders', '/transfers', '/stock', '/notifications', '/timing', '/onec']) {
      revalidatePath(path);
    }

    return { success: true, removed };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Не удалось очистить данные';
    return { success: false, error: message };
  }
}
