import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@prodtrack/db';
import { requireSession } from '@/lib/auth/session';
import { revalidatePath } from 'next/cache';
import { markNotificationReadAction } from '../actions';

vi.mock('@prodtrack/db', () => ({
  prisma: {
    notification: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('@/lib/auth/session', () => ({
  requireSession: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

describe('markNotificationReadAction (M09 BR-4, BR-5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: 'user-1',
      user: { id: 'user-1', active: true, roles: [{ role: { code: 'KSGP' } }] },
    });
  });

  it('отмечает своё непрочитанное уведомление и фиксирует время', async () => {
    (prisma.notification.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'n-1',
      recipientId: 'user-1',
      readAt: null,
    });
    (prisma.notification.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'n-1' });

    const result = await markNotificationReadAction('n-1');

    expect(result).toEqual({ success: true });
    const updateArgs = (prisma.notification.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: 'n-1' });
    expect(updateArgs.data.readAt).toBeInstanceOf(Date);
    expect(revalidatePath).toHaveBeenCalledWith('/notifications');
  });

  it('не перезаписывает время у уже прочитанного уведомления', async () => {
    (prisma.notification.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'n-1',
      recipientId: 'user-1',
      readAt: new Date('2026-10-03T09:00:00.000Z'),
    });

    const result = await markNotificationReadAction('n-1');

    expect(result).toEqual({ success: true });
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });

  it('запрещает отметить чужое уведомление (BR-5)', async () => {
    (prisma.notification.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'n-2',
      recipientId: 'user-2',
      readAt: null,
    });

    const result = await markNotificationReadAction('n-2');

    expect(result).toEqual({
      success: false,
      error: 'Уведомление принадлежит другому пользователю',
    });
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });

  it('сообщает об отсутствующем уведомлении', async () => {
    (prisma.notification.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await markNotificationReadAction('unknown');

    expect(result.success).toBe(false);
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });
});
