import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));
vi.mock('@prodtrack/db', () => ({
  prisma: { notification: { findMany: vi.fn(), count: vi.fn() } },
}));

import { getSession } from '@/lib/auth/session';
import { prisma } from '@prodtrack/db';
import NotificationsServerPage from '../page';

describe('Серверная страница центра уведомлений (M09 T-045)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: 'user-1',
      user: { id: 'user-1', roles: [{ role: { code: 'KSGP' } }] },
    });
    (prisma.notification.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.notification.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
  });

  it('без сессии перенаправляет на страницу входа', async () => {
    (getSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await expect(NotificationsServerPage({ searchParams: {} })).rejects.toThrow('NEXT_REDIRECT');
    expect(prisma.notification.findMany).not.toHaveBeenCalled();
  });

  it('по умолчанию показывает все уведомления пользователя, новые сверху', async () => {
    const element = await NotificationsServerPage({ searchParams: {} });

    expect(element.type).toBe('main');
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { recipientId: 'user-1' },
        orderBy: [{ createdAt: 'desc' }],
        skip: 0,
        take: 21,
      }),
    );
  });

  it('фильтр из строки запроса применяется к выборке', async () => {
    await NotificationsServerPage({ searchParams: { filter: 'UNREAD', page: '2' } });

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { recipientId: 'user-1', readAt: null },
        skip: 20,
        take: 21,
      }),
    );
  });

  it('считает непрочитанные для счётчика в шапке (M09 §8)', async () => {
    (prisma.notification.count as ReturnType<typeof vi.fn>).mockResolvedValue(4);

    await NotificationsServerPage({ searchParams: { filter: 'READ' } });

    expect(prisma.notification.count).toHaveBeenCalledWith({
      where: { recipientId: 'user-1', readAt: null },
    });
  });
});
