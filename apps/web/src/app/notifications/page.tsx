export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';

import NotificationsPage from './_client-page';
import { getNotifications } from './queries';

/**
 * Центр уведомлений M09 (T-045).
 *
 * Права: просмотр своих уведомлений доступен всем аутентифицированным ролям
 * (M09 §3), поэтому проверяется только наличие сессии, а выборка всегда
 * ограничена текущим пользователем (BR-5).
 */
export default async function NotificationsServerPage() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const notifications = await getNotifications(session.userId, 'ALL');
  const unreadCount = notifications.filter((item) => !item.readAt).length;

  return (
    <main className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-graphite">Уведомления</h1>
        <p className="text-sm text-machine-gray">
          Показаны только ваши уведомления (M09 BR-5). Новые — сверху
          {unreadCount > 0 ? ', непрочитанных: ' + unreadCount : ''}.
        </p>
      </div>
      <NotificationsPage notifications={notifications} />
    </main>
  );
}
