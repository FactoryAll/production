import type { Metadata } from 'next';
import './globals.css';

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
      <body className="bg-graphite-surface text-graphite">{children}</body>
    </html>
  );
}
