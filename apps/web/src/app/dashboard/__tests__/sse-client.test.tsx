import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';

const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
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

import DashboardPage from '../_client-page';

const baseProps = {
  revision: 'r-1',
  period: 'SHIFT' as const,
  filter: { type: 'ALL' as const, status: 'ALL' },
  scope: 'ALL' as const,
  inProduction: { ordersCount: 1, plannedMass: 100, plannedGp: 0, workCenterCount: 1, lines: [] },
  produced: { mass: 0, pf: 0, gp: 0 },
  transfers: { count: 0, plannedQuantity: 0 },
  received: { count: 0, quantity: 0 },
  durations: [],
  documents: [],
};

describe('Сводный дашборд: реакция на SSE-кадры (M11 BR-2, UC-M11-2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeEventSource.instances = [];
    (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
  });

  it('подписывается на канал дашборда', () => {
    render(<DashboardPage {...baseProps} />);

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe('/api/events/dashboard');
  });

  it('обновляет показатели, когда состояние данных изменилось', () => {
    render(<DashboardPage {...baseProps} />);

    act(() => {
      FakeEventSource.instances[0].emit({ revision: 'r-2' });
    });

    expect(refresh).toHaveBeenCalled();
  });

  it('не обновляет экран, если отпечаток совпадает с рендером', () => {
    render(<DashboardPage {...baseProps} />);

    act(() => {
      FakeEventSource.instances[0].emit({ revision: 'r-1' });
    });

    expect(refresh).not.toHaveBeenCalled();
  });

  it('игнорирует некорректный кадр и не падает', () => {
    render(<DashboardPage {...baseProps} />);

    act(() => {
      FakeEventSource.instances[0].onmessage?.({ data: 'не json' });
    });

    expect(refresh).not.toHaveBeenCalled();
  });

  it('отключает подписку, когда real-time выключен', () => {
    render(<DashboardPage {...baseProps} refreshIntervalMs={0} />);

    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('закрывает канал при уходе с экрана', () => {
    const { unmount } = render(<DashboardPage {...baseProps} />);

    unmount();

    expect(FakeEventSource.instances[0].closed).toBe(true);
  });
});
