import type { Metadata } from 'next';
import './globals.css';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { getSession } from '@/lib/auth/session';
import { getUnreadNotificationCount } from '@/app/notifications/queries';

export const metadata: Metadata = {
  title: 'ProdTrack',
  description: 'Учёт производственных операций',
  icons: {
    // Оба варианта лежат в public: файловая иконка (app/icon.svg) перекрывала бы этот список
    // целиком. Светлая тема — исходный знак FactoryAll, тёмная — знак на фирменной подложке,
    // иначе чёрный контур не читается на тёмной вкладке браузера.
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/logo-mark.svg', type: 'image/svg+xml', media: '(prefers-color-scheme: dark)' },
    ],
  },
};

export default async function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  // Индикатор непрочитанных уведомлений в шапке (M09 §8).
  const unreadCount = session ? await getUnreadNotificationCount(session.userId) : 0;

  return (
    <html lang="ru">
      <body className="bg-graphite-surface text-graphite flex min-h-screen flex-col">
        {session && <Header user={session.user} unreadCount={unreadCount} />}
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
