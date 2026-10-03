// Общие части SSE-канала уведомлений M09 (tech_stack.md §5).
//
// Вынесено из route-handler: в файле маршрута можно экспортировать только
// HTTP-методы и настройки сегмента, поэтому чистые функции живут здесь.

/** Интервал опроса БД внутри канала (мс). */
export const NOTIFICATION_STREAM_INTERVAL_MS = 5000;

/**
 * Интервал keep-alive-комментария (мс).
 *
 * Кадр-комментарий не вызывает onmessage на клиенте, но удерживает соединение
 * живым: у nginx по умолчанию proxy_read_timeout 60s, и без трафика канал
 * закрывался бы на простое.
 */
export const NOTIFICATION_STREAM_PING_MS = 15000;

export interface NotificationStreamPayload {
  /** Количество непрочитанных уведомлений пользователя. */
  unreadCount: number;
  /** Идентификатор последнего уведомления — признак появления нового. */
  latestId: string | null;
}

/** Кадр SSE: строка "data: <json>" и пустая строка после неё. */
export function notificationStreamFrame(payload: NotificationStreamPayload): string {
  return 'data: ' + JSON.stringify(payload) + '\n\n';
}

/** Кадр keep-alive (комментарий SSE): клиент его игнорирует, соединение остаётся открытым. */
export function notificationStreamPing(): string {
  return ': ping\n\n';
}

/** Изменилось ли состояние по сравнению с предыдущим кадром (шлём только изменения). */
export function isNotificationStreamChanged(
  previous: NotificationStreamPayload,
  next: NotificationStreamPayload,
): boolean {
  return previous.unreadCount !== next.unreadCount || previous.latestId !== next.latestId;
}
