import type { Metadata } from 'next';
import './globals.css';
import { Footer } from '@/components/footer';

export const metadata: Metadata = {
  title: 'ProdTrack',
  description: 'Учёт производственных операций'
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body className="bg-graphite-surface text-graphite flex min-h-screen flex-col">
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}