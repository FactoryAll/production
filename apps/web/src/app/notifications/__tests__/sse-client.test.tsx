import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';

const markNotificationReadAction = vi.fn();
const push = vi.fn();
const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
}));

vi.mock('../actions', () => ({
  markNotificationReadAction: (...args: unknown[]) => markNotificationReadAction(...args),
}));

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

import NotificationsPage from '../_client-page';
import type { NotificationItem } from '../labels';

const notification: NotificationItem = {
  id: 'n-1',
  eventCode: 'EV_01',
  title: 'Подтверждено производственное задание',
  body: JSON.stringify({ orderId: 'po-1', shiftId: 's-1', linesCount: 1 }),
  deepLink: '/production-orders/po-1',
  readAt: null,
  createdAt: '2026-10-04T14:25:13.000Z',
};

describe('Центр уведомлений: реакция на SSE-кадры (M09 T-045)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeEventSource.instances = [];
    (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
  });

  it('подписывается на канал уведомлений', () => {
    render(<NotificationsPage notifications={[notification]} filter="ALL" unreadCount={1} />);

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe('/api/events/notifications');
  });

  it('обновляет страницу, когда приходит кадр с новым состоянием', () => {
    render(<NotificationsPage notifications={[notification]} filter="ALL" unreadCount={1} />);

    act(() => {
      FakeEventSource.instances[0].emit({ unreadCount: 2, latestId: 'n-2' });
    });

    expect(refresh).toHaveBeenCalled();
  });

  it('не обновляет страницу, если состояние не изменилось (первый кадр совпадает с рендером)', () => {
    render(<NotificationsPage notifications={[notification]} filter="ALL" unreadCount={1} />);

    act(() => {
      FakeEventSource.instances[0].emit({ unreadCount: 1, latestId: 'n-1' });
    });

    expect(refresh).not.toHaveBeenCalled();
  });

  it('игнорирует некорректный кадр и не падает', () => {
    render(<NotificationsPage notifications={[notification]} filter="ALL" unreadCount={1} />);

    act(() => {
      FakeEventSource.instances[0].onmessage?.({ data: 'не json' });
    });

    expect(refresh).not.toHaveBeenCalled();
  });
});
