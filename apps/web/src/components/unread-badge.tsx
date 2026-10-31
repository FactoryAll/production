'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { subscribeToNotificationStream } from '@/lib/notifications/stream-client';

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
    // Канал общий на всё приложение (уровень 1, 01.11.2026): второго EventSource больше нет.
    return subscribeToNotificationStream((frame) => {
      if (typeof frame.unreadCount === 'number') {
        setCount(frame.unreadCount);
      }
    });
  }, []);

  return (
    <Link
      href="/notifications"
      aria-label={count > 0 ? 'Уведомления, непрочитанных: ' + count : 'Уведомления'}
      title="Уведомления"
      className="relative flex items-center rounded-sm px-2 py-2 text-neutral-200 transition-colors hover:bg-white/10 hover:text-white"
    >
      {/* Иконка, а не слово: пункт «Уведомления» уже есть в главном меню, и две
          одинаковые подписи рядом читались как ошибка (замечание владельца 25.10.2026). */}
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </svg>
      {count > 0 && (
        <span
          data-testid="unread-badge"
          className="ml-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-signal-amber px-1 text-xs font-semibold text-graphite"
        >
          {count}
        </span>
      )}
    </Link>
  );
}
