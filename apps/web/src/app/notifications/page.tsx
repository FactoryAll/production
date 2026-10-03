export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { Pagination } from '@/components/pagination';

import NotificationsPage from './_client-page';
import { getNotificationsPage, getUnreadNotificationCount, type NotificationFilter } from './queries';

interface NotificationsServerPageProps {
  searchParams: {
    filter?: string;
    page?: string;
  };
}

/**
 * Центр уведомлений M09 (T-045).
 *
 * Права: просмотр своих уведомлений доступен всем аутентифицированным ролям
 * (M09 §3), поэтому проверяется только наличие сессии, а выборка всегда
 * ограничена текущим пользователем (BR-5).
 */
export default async function NotificationsServerPage({
  searchParams,
}: NotificationsServerPageProps) {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const filter: NotificationFilter =
    searchParams.filter === 'UNREAD' || searchParams.filter === 'READ'
      ? searchParams.filter
      : 'ALL';

  const [result, unreadCount] = await Promise.all([
    getNotificationsPage(session.userId, filter, searchParams.page),
    getUnreadNotificationCount(session.userId),
  ]);

  return (
    <main className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-graphite">Уведомления</h1>
        <p className="text-sm text-machine-gray">
          Показаны только ваши уведомления (M09 BR-5). Новые — сверху
          {unreadCount > 0 ? ', непрочитанных: ' + unreadCount : ''}.
        </p>
      </div>

      <NotificationsPage
        notifications={result.items}
        filter={filter}
        unreadCount={unreadCount}
      />

      <Pagination
        pathname="/notifications"
        searchParams={searchParams}
        page={result.page}
        hasNextPage={result.hasNextPage}
      />
    </main>
  );
}
