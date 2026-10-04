import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
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

import { UnreadBadge } from '../unread-badge';

describe('Счётчик непрочитанных в шапке (M09 §8, живое обновление)', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
  });

  it('показывает начальное значение и значение 0 без метки', () => {
    const { unmount } = render(<UnreadBadge initialCount={3} />);
    expect(screen.getByTestId('unread-badge').textContent).toBe('3');
    unmount();

    render(<UnreadBadge initialCount={0} />);
    expect(screen.queryByTestId('unread-badge')).toBeNull();
  });

  it('подписывается на канал уведомлений', () => {
    render(<UnreadBadge initialCount={1} />);
    expect(FakeEventSource.instances[0]?.url).toBe('/api/events/notifications');
  });

  it('обновляет счётчик по кадру, не требуя перехода или перезагрузки', () => {
    render(<UnreadBadge initialCount={11} />);

    act(() => {
      FakeEventSource.instances[0].emit({ unreadCount: 13, latestId: 'n-13' });
    });

    expect(screen.getByTestId('unread-badge').textContent).toBe('13');
  });

  it('скрывает метку, когда всё прочитано', () => {
    render(<UnreadBadge initialCount={2} />);

    act(() => {
      FakeEventSource.instances[0].emit({ unreadCount: 0, latestId: 'n-1' });
    });

    expect(screen.queryByTestId('unread-badge')).toBeNull();
  });

  it('не падает на некорректном кадре', () => {
    render(<UnreadBadge initialCount={4} />);

    act(() => {
      FakeEventSource.instances[0].onmessage?.({ data: 'не json' });
    });

    expect(screen.getByTestId('unread-badge').textContent).toBe('4');
  });
});
