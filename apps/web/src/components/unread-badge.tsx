'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

/**
 * Счётчик непрочитанных уведомлений в шапке (M09 §8).
 *
 * Подписан на SSE-канал, поэтому обновляется сам на любой странице, а не только
 * после перехода или перезагрузки (владелец продукта, 04.10.2026).
 */
export function UnreadBadge({ initialCount }: { initialCount: number }) {
  const [count, setCount] = useState(initialCount);

  // Серверный рендер принёс новое значение (например, после перехода) — синхронизируемся.
  useEffect(() => {
    setCount(initialCount);
  }, [initialCount]);

  useEffect(() => {
    if (typeof EventSource === 'undefined') {
      return undefined;
    }

    const source = new EventSource('/api/events/notifications');
    source.onmessage = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as { unreadCount: number };
        if (typeof payload.unreadCount === 'number') {
          setCount(payload.unreadCount);
        }
      } catch {
        // Некорректный кадр не должен ломать шапку.
      }
    };
    source.onerror = () => {
      // Канал переподключается сам; счётчик остаётся последним известным.
    };

    return () => source.close();
  }, []);

  return (
    <Link
      href="/notifications"
      aria-label={count > 0 ? 'Уведомления, непрочитанных: ' + count : 'Уведомления'}
      className="relative rounded-sm px-3 py-2 text-sm font-medium text-neutral-200 transition-colors hover:bg-white/10 hover:text-white"
    >
      Уведомления
      {count > 0 && (
        <span
          data-testid="unread-badge"
          className="ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-signal-amber px-1 text-xs font-semibold text-graphite"
        >
          {count}
        </span>
      )}
    </Link>
  );
}
