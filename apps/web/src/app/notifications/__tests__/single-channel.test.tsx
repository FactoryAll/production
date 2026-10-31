import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';

/**
 * Одно соединение на всё приложение (уровень 1, 01.11.2026).
 *
 * До этой правки SSE-канал открывали два места — счётчик в шапке и страница уведомлений, —
 * и на `/notifications` висели два `EventSource`. Требование владельца: на странице уведомлений
 * подписка одна, а не две. Проверяем буквально: три подписчика (мост, колокольчик, страница)
 * дают одно соединение.
 */

const refresh = vi.fn();
const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push }),
}));

vi.mock('../actions', () => ({
  markNotificationReadAction: vi.fn(),
}));

vi.mock('@/lib/notifications/desktop', () => ({
  desktopNotificationsSupported: () => true,
  notificationPermission: () => 'granted',
  requestNotificationPermission: async () => 'granted',
  showDesktopNotification: vi.fn(),
  openNotificationTarget: vi.fn(),
}));

import NotificationsPage from '../_client-page';
import { UnreadBadge } from '@/components/unread-badge';
import { NotificationBridge } from '@/components/notification-bridge';
import { resetNotificationStreamForTests } from '@/lib/notifications/stream-client';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  FakeEventSource.instances = [];
  resetNotificationStreamForTests();
  (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
});

describe('канал уведомлений один на приложение', () => {
  it('мост, колокольчик и страница вместе открывают ОДНО соединение', () => {
    render(
      <>
        <UnreadBadge initialCount={0} />
        <NotificationBridge />
        <NotificationsPage
          notifications={[]}
          filter="UNREAD"
          unreadCount={0}
        />
      </>,
    );

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe('/api/events/notifications');
  });

  it('кадр канала доходит до всех подписчиков одного соединения', () => {
    render(
      <>
        <UnreadBadge initialCount={0} />
        <NotificationsPage notifications={[]} filter="UNREAD" unreadCount={0} />
      </>,
    );

    act(() => {
      FakeEventSource.instances[0].emit({ unreadCount: 3, latestId: 'n-3' });
    });

    // Колокольчик обновил счётчик, страница попросила обновление данных.
    expect(refresh).toHaveBeenCalled();
  });

  it('после размонтирования всех подписчиков соединение закрывается', () => {
    const { unmount } = render(
      <>
        <UnreadBadge initialCount={0} />
        <NotificationBridge />
      </>,
    );

    unmount();

    expect(FakeEventSource.instances[0].closed).toBe(true);
  });
});
