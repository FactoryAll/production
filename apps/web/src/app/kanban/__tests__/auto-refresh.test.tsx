import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

// vi.hoisted: фабрика vi.mock поднимается выше объявлений, обычный const там был бы в TDZ.
const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { AutoRefresh, AUTO_REFRESH_INTERVAL_MS, RefreshButton } from '../_components/auto-refresh';

/**
 * Автообновление доски (решение владельца 31.10.2026, пункт 4).
 *
 * Требования: опрос раз в минуту; в скрытой вкладке сервер не дёргаем; кнопка «Обновить»
 * обновляет по требованию. Фильтры и прокрутка не сбрасываются, потому что обновление идёт
 * через `router.refresh()`, а не переходом.
 */
function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
}

describe('автообновление доски', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refresh.mockReset();
    setHidden(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    setHidden(false);
  });

  it('опрос идёт раз в минуту и обновляет данные без перехода', () => {
    render(<AutoRefresh />);

    act(() => {
      vi.advanceTimersByTime(AUTO_REFRESH_INTERVAL_MS);
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(AUTO_REFRESH_INTERVAL_MS);
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('меньше минуты — обновления нет', () => {
    render(<AutoRefresh />);

    act(() => {
      vi.advanceTimersByTime(AUTO_REFRESH_INTERVAL_MS - 1);
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('в скрытой вкладке сервер не дёргаем', () => {
    setHidden(true);
    render(<AutoRefresh />);

    act(() => {
      vi.advanceTimersByTime(AUTO_REFRESH_INTERVAL_MS * 3);
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('когда вкладка снова видима — опрос возобновляется', () => {
    setHidden(true);
    render(<AutoRefresh />);

    act(() => {
      vi.advanceTimersByTime(AUTO_REFRESH_INTERVAL_MS);
    });
    expect(refresh).not.toHaveBeenCalled();

    setHidden(false);
    act(() => {
      vi.advanceTimersByTime(AUTO_REFRESH_INTERVAL_MS);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('при размонтировании таймер останавливается', () => {
    const { unmount } = render(<AutoRefresh />);
    unmount();

    act(() => {
      vi.advanceTimersByTime(AUTO_REFRESH_INTERVAL_MS * 2);
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('кнопка «Обновить»', () => {
  beforeEach(() => {
    refresh.mockReset();
  });

  it('обновляет по требованию, не дожидаясь опроса', () => {
    render(<RefreshButton />);

    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));

    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
