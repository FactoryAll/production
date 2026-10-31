/**
 * Один SSE-канал уведомлений на всё приложение (уровень 1, 01.11.2026).
 *
 * Раньше канал открывали в двух местах — счётчик в шапке и страница уведомлений, — и на
 * `/notifications` висели два соединения. Теперь подписка одна: модуль держит единственный
 * `EventSource` и раздаёт кадры всем подписчикам, а закрывает соединение, когда не осталось
 * ни одного.
 *
 * Кадр канала: `{ unreadCount, latestId, latest? }`, где `latest` — текст и ссылка последнего
 * уведомления для системного уведомления на рабочем столе.
 */

export interface NotificationStreamLatest {
  id: string;
  title: string;
  body: string | null;
  deepLink: string | null;
}

export interface NotificationStreamFrame {
  unreadCount: number;
  latestId: string | null;
  latest?: NotificationStreamLatest | null;
}

type Listener = (frame: NotificationStreamFrame) => void;

const STREAM_URL = '/api/events/notifications';

let source: EventSource | null = null;
let lastFrame: NotificationStreamFrame | null = null;
const listeners = new Set<Listener>();

function openSource(): void {
  if (source !== null || typeof EventSource === 'undefined') {
    return;
  }

  source = new EventSource(STREAM_URL);
  source.onmessage = (event: MessageEvent<string>) => {
    let frame: NotificationStreamFrame;
    try {
      frame = JSON.parse(event.data) as NotificationStreamFrame;
    } catch {
      // Некорректный кадр не должен ломать ни шапку, ни страницу.
      return;
    }
    lastFrame = frame;
    for (const listener of [...listeners]) {
      try {
        listener(frame);
      } catch {
        // Один подписчик не должен уронить остальных.
      }
    }
  };
  source.onerror = () => {
    // Канал переподключается сам; последние известные данные остаются у подписчиков.
  };
}

function closeSource(): void {
  if (source !== null) {
    source.close();
    source = null;
  }
}

/** Подписка на кадры канала. Возвращает функцию отписки. */
export function subscribeToNotificationStream(listener: Listener): () => void {
  listeners.add(listener);
  openSource();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      closeSource();
    }
  };
}

/** Последний полученный кадр (нужен подписчику, пришедшему позже остальных). */
export function getLastNotificationFrame(): NotificationStreamFrame | null {
  return lastFrame;
}

/** Только для тестов: сбросить соединение и подписчиков между прогонами. */
export function resetNotificationStreamForTests(): void {
  closeSource();
  listeners.clear();
  lastFrame = null;
}
