'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@prodtrack/db';
import { requireSession } from '@/lib/auth/session';

export type MarkNotificationReadResult = { success: true } | { success: false; error: string };

/**
 * Отметка уведомления прочитанным (M09 BR-4, UC-M09-3).
 * Пользователь может отметить только своё уведомление (BR-5).
 */
export async function markNotificationReadAction(
  notificationId: string,
): Promise<MarkNotificationReadResult> {
  try {
    const session = await requireSession();

    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
      select: { id: true, recipientId: true, readAt: true },
    });

    if (!notification) {
      throw new Error('Уведомление не найдено');
    }

    if (notification.recipientId !== session.userId) {
      throw new Error('Уведомление принадлежит другому пользователю');
    }

    if (!notification.readAt) {
      await prisma.notification.update({
        where: { id: notificationId },
        data: { readAt: new Date() },
      });
    }

    revalidatePath('/notifications');
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Не удалось отметить уведомление прочитанным',
    };
  }
}
