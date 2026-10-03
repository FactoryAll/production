'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { dbCodeToEventCode } from '@prodtrack/contracts';
import { Card } from '@prodtrack/ui';
import { markNotificationReadAction } from './actions';
import {
  describeNotification,
  NOTIFICATION_FILTERS,
  type NotificationFilter,
  type NotificationItem,
} from './labels';

interface NotificationsPageProps {
  notifications: NotificationItem[];
  /** Текущий фильтр прочитанности (M09 §8), задаётся строкой запроса. */
  filter: NotificationFilter;
  /** Количество непрочитанных уведомлений — для кнопки фильтра и шапки. */
  unreadCount: number;
  /** Интервал опроса SSE-канала, мс (0 — отключить real-time). */
  refreshIntervalMs?: number;
}

export default function NotificationsPage({
  notifications,
  filter,
  unreadCount,
  refreshIntervalMs = 10000,
}: NotificationsPageProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  // Real-time: SSE-канал M09 обновляет список и счётчик без перезагрузки страницы.
  useEffect(() => {
    if (refreshIntervalMs <= 0 || typeof EventSource === 'undefined') {
      return undefined;
    }

    const source = new EventSource('/api/events/notifications');
    source.onmessage = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as { unreadCount: number; latestId: string | null };
        const latestId = notifications[0]?.id ?? null;
        if (payload.unreadCount !== unreadCount || payload.latestId !== latestId) {
          router.refresh();
        }
      } catch {
        // Некорректный кадр канала не должен ломать экран.
      }
    };
    source.onerror = () => {
      // Канал сам переподключится; падать не нужно.
    };

    return () => source.close();
  }, [notifications, refreshIntervalMs, router, unreadCount]);

  async function handleOpen(item: NotificationItem) {
    setError(null);
    setPendingId(item.id);

    try {
      // BR-4: прочитанность фиксируется при открытии/переходе.
      if (!item.readAt) {
        const result = await markNotificationReadAction(item.id);
        if (!result.success) {
          setError(result.error ?? 'Не удалось отметить уведомление прочитанным');
          return;
        }
      }

      // BR-2: каждое уведомление ведёт в целевой объект.
      if (item.deepLink) {
        router.push(item.deepLink);
      } else {
        router.refresh();
      }
    } finally {
      setPendingId(null);
    }
  }

  function handleFilterChange(value: NotificationFilter) {
    const query = value === 'ALL' ? '' : '?filter=' + value;
    router.push('/notifications' + query);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {NOTIFICATION_FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => handleFilterChange(option.value)}
            className={
              'h-[var(--button-height-sm)] rounded-md border px-4 text-sm font-medium transition-colors ' +
              (filter === option.value
                ? 'border-deep-industry-blue bg-deep-industry-blue text-white'
                : 'border-mist-metal bg-white text-graphite hover:bg-cold-white-gray')
            }
          >
            {option.label}
            {option.value === 'UNREAD' && unreadCount > 0 ? ' (' + unreadCount + ')' : ''}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-md border border-signal-amber bg-cold-white-gray px-4 py-3 text-sm text-graphite">
          {error}
        </div>
      )}

      {notifications.length === 0 ? (
        <Card className="p-6 text-sm text-machine-gray">Уведомлений нет.</Card>
      ) : (
        <ul className="space-y-2">
          {notifications.map((item) => {
            const isUnread = !item.readAt;
            const specCode = dbCodeToEventCode(item.eventCode) ?? item.eventCode;

            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => handleOpen(item)}
                  disabled={pendingId === item.id}
                  className={
                    'w-full rounded-lg border p-4 text-left transition-colors ' +
                    (isUnread
                      ? 'border-signal-amber bg-white hover:bg-cold-white-gray'
                      : 'border-mist-metal bg-cold-white-gray hover:bg-white')
                  }
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        {isUnread && (
                          <span
                            aria-label="Непрочитано"
                            className="inline-block h-2 w-2 rounded-full bg-signal-amber"
                          />
                        )}
                        <span className="text-sm font-semibold text-graphite">{item.title}</span>
                        <span className="text-xs text-machine-gray">{specCode}</span>
                      </div>
                      <p className="text-sm text-steel-graphite">{describeNotification(item)}</p>
                    </div>
                    <time className="whitespace-nowrap text-xs text-machine-gray">
                      {new Date(item.createdAt).toLocaleString('ru-RU')}
                    </time>
                  </div>
                  {item.deepLink && (
                    <span className="mt-2 inline-block text-xs font-medium text-deep-industry-blue">
                      Перейти: {item.deepLink}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
