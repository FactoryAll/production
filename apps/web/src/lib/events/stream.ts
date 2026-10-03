// Общие части SSE-канала уведомлений M09 (tech_stack.md §5).
//
// Вынесено из route-handler: в файле маршрута можно экспортировать только
// HTTP-методы и настройки сегмента, поэтому чистые функции живут здесь.

export const NOTIFICATION_STREAM_INTERVAL_MS = 5000;

export interface NotificationStreamPayload {
  /** Количество непрочитанных уведомлений пользователя. */
  unreadCount: number;
  /** Идентификатор последнего уведомления — признак появления нового. */
  latestId: string | null;
}

/** Кадр SSE (формат `data: <json>\n\n`). */
export function notificationStreamFrame(payload: NotificationStreamPayload): string {
  return 'data: ' + JSON.stringify(payload) + '\n\n';
}

/** Изменилось ли состояние по сравнению с предыдущим кадром (шлём только изменения). */
export function isNotificationStreamChanged(
  previous: NotificationStreamPayload,
  next: NotificationStreamPayload,
): boolean {
  return previous.unreadCount !== next.unreadCount || previous.latestId !== next.latestId;
}
