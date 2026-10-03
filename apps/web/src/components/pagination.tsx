// Навигация по страницам списка (T-057).
// Серверный компонент: ссылки формируются из текущих параметров запроса.

import Link from 'next/link';
import { pageHref } from '@/lib/pagination';

interface PaginationProps {
  pathname: string;
  searchParams: Record<string, string | undefined>;
  page: number;
  hasNextPage: boolean;
}

export function Pagination({ pathname, searchParams, page, hasNextPage }: PaginationProps) {
  if (page === 1 && !hasNextPage) {
    return null;
  }

  return (
    <nav className="mt-4 flex items-center gap-3 text-sm" aria-label="Постраничная навигация">
      {page > 1 && (
        <Link
          href={pageHref(pathname, searchParams, page - 1)}
          className="rounded-md border border-mist-metal bg-white px-4 py-2 font-medium text-graphite hover:bg-cold-white-gray"
        >
          ← Предыдущая
        </Link>
      )}

      <span className="text-machine-gray">Страница {page}</span>

      {hasNextPage && (
        <Link
          href={pageHref(pathname, searchParams, page + 1)}
          className="rounded-md border border-mist-metal bg-white px-4 py-2 font-medium text-graphite hover:bg-cold-white-gray"
        >
          Следующая →
        </Link>
      )}
    </nav>
  );
}
