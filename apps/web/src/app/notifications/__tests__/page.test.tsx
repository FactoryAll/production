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
import type { NotificationItem } from '../labels';

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

describe('Центр уведомлений: переход и прочитанность (M09 BR-2, BR-4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markNotificationReadAction.mockResolvedValue({ success: true });
  });

  it('по клику отмечает уведомление прочитанным и открывает целевой объект', async () => {
    render(<NotificationsPage notifications={[buildItem({})]} refreshIntervalMs={0} />);

    fireEvent.click(screen.getByRole('button', { name: /Перемещение отправлено/ }));

    await waitFor(() => {
      expect(markNotificationReadAction).toHaveBeenCalledWith('n-1');
    });
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/transfers/tr-1');
    });
  });

  it('для прочитанного уведомления не вызывает отметку, но ведёт по ссылке', async () => {
    render(
      <NotificationsPage
        notifications={[buildItem({ id: 'n-2', readAt: '2026-10-03T11:00:00.000Z' })]}
        refreshIntervalMs={0}
      />,
    );

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

    render(<NotificationsPage notifications={[buildItem({})]} refreshIntervalMs={0} />);
    fireEvent.click(screen.getByRole('button', { name: /Перемещение отправлено/ }));

    await waitFor(() => {
      expect(
        screen.getByText('Уведомление принадлежит другому пользователю'),
      ).toBeTruthy();
    });
    expect(push).not.toHaveBeenCalled();
  });

  it('фильтр «Непрочитанные» скрывает прочитанные уведомления', async () => {
    render(
      <NotificationsPage
        notifications={[
          buildItem({ id: 'n-1' }),
          buildItem({
            id: 'n-2',
            title: 'Перемещение отменено',
            eventCode: 'EV_10',
            readAt: '2026-10-03T11:00:00.000Z',
          }),
        ]}
        refreshIntervalMs={0}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Непрочитанные/ }));

    await waitFor(() => {
      expect(screen.queryByText('Перемещение отменено')).toBeNull();
    });
    expect(screen.getByText('Перемещение отправлено')).toBeTruthy();
  });

  it('показывает маршрут складов из payload (M09 §8)', () => {
    render(<NotificationsPage notifications={[buildItem({})]} refreshIntervalMs={0} />);
    expect(screen.getByText('Производственный склад → Склад ГП')).toBeTruthy();
  });
});
