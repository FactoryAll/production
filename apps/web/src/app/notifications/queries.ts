// Read-side центра уведомлений M09 (T-045).
//
// Модуль намеренно без 'use server': это обычные функции чтения данных
// (урок Фазы 3 — запросы не держать в 'use server'-файлах).

import { prisma } from '@prodtrack/db';
import { parsePageParam, toPageResult, type PageResult } from '@/lib/pagination';

export type NotificationFilter = 'ALL' | 'UNREAD' | 'READ';

export interface NotificationItem {
  id: string;
  eventCode: string;
  title: string;
  body: string | null;
  deepLink: string | null;
  readAt: string | null;
  createdAt: string;
}

/** Условие выборки по фильтру прочитанности (M09 §8). */
export function notificationFilterWhere(filter: NotificationFilter) {
  if (filter === 'UNREAD') {
    return { readAt: null };
  }
  if (filter === 'READ') {
    return { readAt: { not: null } };
  }
  return {};
}

/**
 * Сортировка списка — строго по времени, новые сверху (M09 §11).
 *
 * Ранее для фильтра «Все» первым ключом шло «непрочитанные сверху» (UC-M09-2),
 * но в проде порядок не соблюдался (дефект №5 ручного тестирования v1.2.0).
 * Оставлен один однозначный ключ: новые сверху; непрочитанные отбираются фильтром.
 */
export function notificationOrderBy(_filter: NotificationFilter = 'ALL') {
  return [{ createdAt: 'desc' as const }];
}

function toItem(notification: {
  id: string;
  eventCode: string;
  title: string;
  body: string | null;
  deepLink: string | null;
  readAt: Date | null;
  createdAt: Date;
}): NotificationItem {
  return {
    id: notification.id,
    eventCode: notification.eventCode,
    title: notification.title,
    body: notification.body,
    deepLink: notification.deepLink,
    readAt: notification.readAt ? notification.readAt.toISOString() : null,
    createdAt: notification.createdAt.toISOString(),
  };
}

/** Размер страницы центра уведомлений (T-057). */
export const NOTIFICATIONS_PAGE_SIZE = 20;

/** Уведомления пользователя (только свои — M09 BR-5). */
export async function getNotifications(
  recipientId: string,
  filter: NotificationFilter = 'ALL',
  limit = 100,
): Promise<NotificationItem[]> {
  const notifications = await prisma.notification.findMany({
    where: { recipientId, ...notificationFilterWhere(filter) },
    orderBy: notificationOrderBy(filter),
    take: limit,
  });
  return notifications.map(toItem);
}

/**
 * Страница уведомлений пользователя (T-057): `skip`/`take` без отдельного `count` —
 * признак следующей страницы берётся из «лишней» записи.
 */
export async function getNotificationsPage(
  recipientId: string,
  filter: NotificationFilter = 'ALL',
  pageParam?: string,
): Promise<PageResult<NotificationItem>> {
  const params = parsePageParam(pageParam, NOTIFICATIONS_PAGE_SIZE);

  const notifications = await prisma.notification.findMany({
    where: { recipientId, ...notificationFilterWhere(filter) },
    orderBy: notificationOrderBy(filter),
    skip: params.skip,
    take: params.take,
  });

  return toPageResult(notifications.map(toItem), params);
}

/** Количество непрочитанных — для счётчика в шапке приложения (M09 §8). */
export async function getUnreadNotificationCount(recipientId: string): Promise<number> {
  return prisma.notification.count({ where: { recipientId, readAt: null } });
}
