// Пагинация серверных списков (T-057).
//
// Обычный модуль без 'use server' / 'use client': используется и серверными
// страницами, и презентационным компонентом пагинации.

export const DEFAULT_PAGE_SIZE = 50;

export interface PageParams {
  /** Номер страницы, начиная с 1. */
  page: number;
  /** Размер страницы. */
  pageSize: number;
  /** Смещение для выборки (Prisma `skip`). */
  skip: number;
  /** Лимит выборки (Prisma `take`); на единицу больше размера — чтобы понять, есть ли следующая страница. */
  take: number;
}

/** Разбирает параметр `page` из строки запроса: некорректные значения → первая страница. */
export function parsePageParam(value: string | undefined, pageSize: number = DEFAULT_PAGE_SIZE): PageParams {
  const parsed = Number.parseInt(value ?? '', 10);
  const page = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  const size = pageSize > 0 ? pageSize : DEFAULT_PAGE_SIZE;

  return {
    page,
    pageSize: size,
    skip: (page - 1) * size,
    take: size + 1,
  };
}

export interface PageResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  hasNextPage: boolean;
}

/**
 * Отрезает «лишнюю» запись, по которой определяется наличие следующей страницы.
 * Дополнительный `count` не выполняется — лишних запросов нет.
 */
export function toPageResult<T>(rows: T[], params: PageParams): PageResult<T> {
  const hasNextPage = rows.length > params.pageSize;
  return {
    items: hasNextPage ? rows.slice(0, params.pageSize) : rows,
    page: params.page,
    pageSize: params.pageSize,
    hasNextPage,
  };
}

/**
 * Ссылка на страницу с сохранением текущих фильтров строки запроса.
 * Пустые параметры в ссылку не попадают.
 */
export function pageHref(
  pathname: string,
  searchParams: Record<string, string | undefined>,
  page: number,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === 'page' || value === undefined || value === '') {
      continue;
    }
    query.set(key, value);
  }
  if (page > 1) {
    query.set('page', String(page));
  }
  const queryString = query.toString();
  return queryString ? pathname + '?' + queryString : pathname;
}
