import type { Metadata } from 'next';
import './globals.css';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { getSession } from '@/lib/auth/session';
import { getUnreadNotificationCount } from '@/app/notifications/queries';

export const metadata: Metadata = {
  title: 'ProdTrack',
  description: 'Учёт производственных операций'
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
