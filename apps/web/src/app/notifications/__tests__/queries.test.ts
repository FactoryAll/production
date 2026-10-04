import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@prodtrack/db';
import {
  getNotifications,
  getNotificationsPage,
  getUnreadNotificationCount,
  NOTIFICATIONS_PAGE_SIZE,
  notificationFilterWhere,
  notificationOrderBy,
} from '../queries';

vi.mock('@prodtrack/db', () => ({
  prisma: {
    notification: { findMany: vi.fn(), count: vi.fn() },
  },
}));

describe('notificationFilterWhere (M09 §8)', () => {
  it('для «непрочитанные» фильтрует по readAt = null', () => {
    expect(notificationFilterWhere('UNREAD')).toEqual({ readAt: null });
  });

  it('для «прочитанные» фильтрует по readAt != null', () => {
    expect(notificationFilterWhere('READ')).toEqual({ readAt: { not: null } });
  });

  it('для «все» не накладывает условий', () => {
    expect(notificationFilterWhere('ALL')).toEqual({});
  });
});

describe('notificationOrderBy (M09 §11: новые сверху; дефект №5)', () => {
  it('во «всех» сортировка по времени, новые первыми', () => {
    expect(notificationOrderBy('ALL')).toEqual([{ createdAt: 'desc' }]);
  });

  it('при фильтре по прочитанности сортировка та же', () => {
    expect(notificationOrderBy('UNREAD')).toEqual([{ createdAt: 'desc' }]);
    expect(notificationOrderBy('READ')).toEqual([{ createdAt: 'desc' }]);
  });
});

describe('getNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('выбирает только уведомления получателя (BR-5) и приводит даты к ISO', async () => {
    (prisma.notification.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'n-1',
        eventCode: 'EV_04',
        title: 'Перемещение отправлено',
        body: '{"transferId":"tr-1"}',
        deepLink: '/transfers/tr-1',
        readAt: null,
        createdAt: new Date('2026-10-03T10:00:00.000Z'),
      },
    ]);

    const items = await getNotifications('user-1', 'ALL');

    expect(prisma.notification.findMany).toHaveBeenCalledWith({
      where: { recipientId: 'user-1' },
      orderBy: [{ createdAt: 'desc' }],
      take: 100,
    });
    expect(items).toEqual([
      {
        id: 'n-1',
        eventCode: 'EV_04',
        title: 'Перемещение отправлено',
        body: '{"transferId":"tr-1"}',
        deepLink: '/transfers/tr-1',
        readAt: null,
        createdAt: '2026-10-03T10:00:00.000Z',
      },
    ]);
  });

  it('применяет фильтр прочитанности', async () => {
    (prisma.notification.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await getNotifications('user-1', 'UNREAD');

    expect(prisma.notification.findMany).toHaveBeenCalledWith({
      where: { recipientId: 'user-1', readAt: null },
      orderBy: [{ createdAt: 'desc' }],
      take: 100,
    });
  });
});

describe('getNotificationsPage (T-057)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('берёт страницу уведомлений пользователя с skip по номеру', async () => {
    (prisma.notification.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await getNotificationsPage('user-1', 'UNREAD', '3');

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { recipientId: 'user-1', readAt: null },
        skip: NOTIFICATIONS_PAGE_SIZE * 2,
        take: NOTIFICATIONS_PAGE_SIZE + 1,
      }),
    );
    expect(result).toMatchObject({ page: 3, hasNextPage: false });
  });
});

describe('getUnreadNotificationCount', () => {
  it('считает только непрочитанные уведомления пользователя', async () => {
    (prisma.notification.count as ReturnType<typeof vi.fn>).mockResolvedValue(3);

    await expect(getUnreadNotificationCount('user-1')).resolves.toBe(3);
    expect(prisma.notification.count).toHaveBeenCalledWith({
      where: { recipientId: 'user-1', readAt: null },
    });
  });
});
