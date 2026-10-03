import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@prodtrack/db';
import { getProductsPage, parseActiveFilter, PRODUCTS_PAGE_SIZE, productWhere } from '../queries';

vi.mock('@prodtrack/db', () => ({ prisma: { product: { findMany: vi.fn() } } }));

describe('parseActiveFilter (M01 §8)', () => {
  it('распознаёт активные и неактивные', () => {
    expect(parseActiveFilter('ACTIVE')).toBe('ACTIVE');
    expect(parseActiveFilter('INACTIVE')).toBe('INACTIVE');
  });

  it('прочие значения трактует как «все»', () => {
    expect(parseActiveFilter(undefined)).toBe('ALL');
    expect(parseActiveFilter('other')).toBe('ALL');
  });
});

describe('productWhere — серверный поиск (T-058)', () => {
  it('без запроса и фильтра условий нет', () => {
    expect(productWhere({})).toEqual({});
    expect(productWhere({ q: '   ' })).toEqual({});
  });

  it('ищет по коду и наименованию без учёта регистра', () => {
    expect(productWhere({ q: 'gp' })).toEqual({
      OR: [
        { code: { contains: 'gp', mode: 'insensitive' } },
        { name: { contains: 'gp', mode: 'insensitive' } },
      ],
    });
  });

  it('фильтрует по активности', () => {
    expect(productWhere({ active: 'ACTIVE' })).toEqual({ active: true });
    expect(productWhere({ active: 'INACTIVE' })).toEqual({ active: false });
    expect(productWhere({ active: 'ALL' })).toEqual({});
  });

  it('объединяет поиск и фильтр', () => {
    const where = productWhere({ q: 'масло', active: 'ACTIVE' });
    expect(where.active).toBe(true);
    expect(Array.isArray(where.OR)).toBe(true);
  });
});

describe('getProductsPage (T-057)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('сортирует по коду и берёт страницу с запасной записью', async () => {
    (prisma.product.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await getProductsPage({ q: 'gp' }, '2');

    expect(prisma.product.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { code: { contains: 'gp', mode: 'insensitive' } },
          { name: { contains: 'gp', mode: 'insensitive' } },
        ],
      },
      orderBy: { code: 'asc' },
      skip: PRODUCTS_PAGE_SIZE,
      take: PRODUCTS_PAGE_SIZE + 1,
    });
    expect(result.page).toBe(2);
    expect(result.hasNextPage).toBe(false);
  });

  it('сообщает о следующей странице, если вернулась лишняя запись', async () => {
    const rows = Array.from({ length: PRODUCTS_PAGE_SIZE + 1 }, (_unused, index) => ({ id: 'p-' + String(index) }));
    (prisma.product.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(rows);

    const result = await getProductsPage({});

    expect(result.items).toHaveLength(PRODUCTS_PAGE_SIZE);
    expect(result.hasNextPage).toBe(true);
  });
});
