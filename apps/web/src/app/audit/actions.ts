'use server';

import { revalidatePath } from 'next/cache';
import { archiveOldAuditRecords, prisma } from '@prodtrack/db';
import { requireSession } from '@/lib/auth/session';

export type ArchiveAuditResult =
  | { success: true; archived: number }
  | { success: false; error: string };

/**
 * Архивация аудита (Р-16, BR-6): записи старше 12 месяцев помечаются `archived = true`.
 *
 * Операция идемпотентна и доступна только АДМ — остальным ролям архив не виден.
 * Тот же код используется CLI-скриптом `pnpm db:archive-audit` (для cron на VPS).
 */
export async function archiveOldAuditAction(): Promise<ArchiveAuditResult> {
  try {
    const session = await requireSession();
    const roles = session.user.roles.map((ur) => ur.role.code);

    if (!roles.includes('ADM')) {
      throw new Error('Архивация аудита доступна только администратору (Р-16)');
    }

    const archived = await archiveOldAuditRecords(prisma);
    revalidatePath('/audit');
    return { success: true, archived };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Не удалось архивировать записи аудита',
    };
  }
}
