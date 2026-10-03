import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const markNotificationReadAction = vi.fn();
const push = vi.fn();
const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
}));

vi.mock('../actions', () => ({
  markNotificationReadAction: (...args: unknown[]) => markNotificationReadAction(...args),
}));

import NotificationsPage from '../_client-page';
import type { NotificationFilter, NotificationItem } from '../labels';

function buildItem(partial: Partial<NotificationItem>): NotificationItem {
  return {
    id: 'n-1',
    eventCode: 'EV_04',
    title: 'Перемещение отправлено',
    body: JSON.stringify({
      transferId: 'tr-1',
      sourceWarehouse: { id: 'wh-1', name: 'Производственный склад' },
      destinationWarehouse: { id: 'wh-2', name: 'Склад ГП' },
    }),
    deepLink: '/transfers/tr-1',
    readAt: null,
    createdAt: '2026-10-03T10:00:00.000Z',
    ...partial,
  };
}

function renderPage(
  notifications: NotificationItem[],
  filter: NotificationFilter = 'ALL',
  unreadCount: number = notifications.filter((item) => !item.readAt).length,
) {
  return render(
    <NotificationsPage
      notifications={notifications}
      filter={filter}
      unreadCount={unreadCount}
      refreshIntervalMs={0}
    />,
  );
}

describe('Центр уведомлений: переход и прочитанность (M09 BR-2, BR-4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markNotificationReadAction.mockResolvedValue({ success: true });
  });

  it('по клику отмечает уведомление прочитанным и открывает целевой объект', async () => {
    renderPage([buildItem({})]);

    fireEvent.click(screen.getByRole('button', { name: /Перемещение отправлено/ }));

    await waitFor(() => {
      expect(markNotificationReadAction).toHaveBeenCalledWith('n-1');
    });
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/transfers/tr-1');
    });
  });

  it('для прочитанного уведомления не вызывает отметку, но ведёт по ссылке', async () => {
    renderPage([buildItem({ id: 'n-2', readAt: '2026-10-03T11:00:00.000Z' })]);

    fireEvent.click(screen.getByRole('button', { name: /Перемещение отправлено/ }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/transfers/tr-1');
    });
    expect(markNotificationReadAction).not.toHaveBeenCalled();
  });

  it('при ошибке отметки показывает сообщение и не уводит со страницы', async () => {
    markNotificationReadAction.mockResolvedValue({
      success: false,
      error: 'Уведомление принадлежит другому пользователю',
    });

    renderPage([buildItem({})]);
    fireEvent.click(screen.getByRole('button', { name: /Перемещение отправлено/ }));

    await waitFor(() => {
      expect(screen.getByText('Уведомление принадлежит другому пользователю')).toBeTruthy();
    });
    expect(push).not.toHaveBeenCalled();
  });

  it('фильтр «Непрочитанные» перезапрашивает список с сервера (T-057)', async () => {
    renderPage([buildItem({})]);

    fireEvent.click(screen.getByRole('button', { name: /^Непрочитанные/ }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/notifications?filter=UNREAD');
    });
  });

  it('фильтр «Все» возвращает список без параметра фильтра', async () => {
    renderPage([buildItem({})], 'UNREAD');

    fireEvent.click(screen.getByRole('button', { name: /^Все/ }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/notifications');
    });
  });

  it('показывает маршрут складов из payload (M09 §8)', () => {
    renderPage([buildItem({})]);
    expect(screen.getByText('Производственный склад → Склад ГП')).toBeTruthy();
  });

  it('показывает счётчик непрочитанных на кнопке фильтра', () => {
    renderPage([buildItem({})], 'ALL', 3);
    expect(screen.getByRole('button', { name: 'Непрочитанные (3)' })).toBeTruthy();
  });
});
