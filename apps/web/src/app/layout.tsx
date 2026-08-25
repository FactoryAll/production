import type { Metadata } from 'next';
import './globals.css';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { getSession } from '@/lib/auth/session';

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

  return (
    <html lang="ru">
      <body className="bg-graphite-surface text-graphite flex min-h-screen flex-col">
        {session && <Header />}
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}