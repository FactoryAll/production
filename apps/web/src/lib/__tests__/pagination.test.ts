import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PAGE_SIZE,
  pageHref,
  parsePageParam,
  toPageResult,
} from '../pagination';

describe('parsePageParam (T-057)', () => {
  it('по умолчанию отдаёт первую страницу', () => {
    expect(parsePageParam(undefined)).toEqual({
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      skip: 0,
      take: DEFAULT_PAGE_SIZE + 1,
    });
  });

  it('считает skip по номеру страницы', () => {
    expect(parsePageParam('3', 20)).toEqual({ page: 3, pageSize: 20, skip: 40, take: 21 });
  });

  it('некорректный номер страницы трактует как первую', () => {
    expect(parsePageParam('0').page).toBe(1);
    expect(parsePageParam('-5').page).toBe(1);
    expect(parsePageParam('abc').page).toBe(1);
  });
});

describe('toPageResult (T-057)', () => {
  it('определяет наличие следующей страницы по «лишней» записи', () => {
    const result = toPageResult([1, 2, 3], { page: 1, pageSize: 2, skip: 0, take: 3 });

    expect(result.items).toEqual([1, 2]);
    expect(result.hasNextPage).toBe(true);
  });

  it('на последней странице не отдаёт лишнюю запись', () => {
    const result = toPageResult([1, 2], { page: 2, pageSize: 2, skip: 2, take: 3 });

    expect(result.items).toEqual([1, 2]);
    expect(result.hasNextPage).toBe(false);
  });

  it('пустой результат — страниц больше нет', () => {
    const result = toPageResult([], { page: 1, pageSize: 50, skip: 0, take: 51 });
    expect(result).toMatchObject({ page: 1, pageSize: 50, hasNextPage: false });
  });
});

describe('pageHref (T-057)', () => {
  it('сохраняет фильтры и не пишет параметр для первой страницы', () => {
    expect(
      pageHref('/audit', { objectType: 'ProductionOrder', userId: '' }, 1),
    ).toBe('/audit?objectType=ProductionOrder');
  });

  it('добавляет номер страницы', () => {
    expect(pageHref('/audit', { objectType: 'ProductionOrder' }, 2)).toBe(
      '/audit?objectType=ProductionOrder&page=2',
    );
  });

  it('заменяет прежнее значение номера страницы', () => {
    expect(pageHref('/timing', { page: '2', documentId: 'po-1' }, 3)).toBe(
      '/timing?documentId=po-1&page=3',
    );
  });

  it('без параметров возвращает чистый путь', () => {
    expect(pageHref('/notifications', {}, 2)).toBe('/notifications?page=2');
    expect(pageHref('/notifications', {}, 1)).toBe('/notifications');
  });
});
