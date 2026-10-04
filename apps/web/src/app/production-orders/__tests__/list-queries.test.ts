import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@prodtrack/db';

vi.mock('@prodtrack/db', () => ({
  prisma: { productionOrder: { findMany: vi.fn() } },
}));

// Проверка права в запросе — защита в глубину: подменяем, чтобы не требовался request scope.
vi.mock('@/lib/auth/access', () => ({
  requirePermission: vi.fn().mockResolvedValue({ userId: 'user-1' }),
  requireAnyPermission: vi.fn().mockResolvedValue({ userId: 'user-1' }),
}));

import { getOrdersPage, ORDERS_PAGE_SIZE, orderWhere, parseOrderStatusFilter } from '../queries';
import { requirePermission } from '@/lib/auth/access';

describe('список ПЗ: серверный фильтр и пагинация (T-057/T-058)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('распознаёт только допустимые статусы', () => {
    expect(parseOrderStatusFilter('IN_PROGRESS')).toBe('IN_PROGRESS');
    expect(parseOrderStatusFilter(undefined)).toBe('ALL');
    expect(parseOrderStatusFilter('UNKNOWN')).toBe('ALL');
  });

  it('фильтр «все» не накладывает условий', () => {
    expect(orderWhere({ status: 'ALL' })).toEqual({});
    expect(orderWhere({})).toEqual({});
  });

  it('фильтрует по статусу и берёт страницу с запасной записью', async () => {
    (prisma.productionOrder.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await getOrdersPage({ status: 'CONFIRMED' }, '2');

    expect(prisma.productionOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'CONFIRMED' },
        orderBy: { createdAt: 'desc' },
        skip: ORDERS_PAGE_SIZE,
        take: ORDERS_PAGE_SIZE + 1,
      }),
    );
    expect(result.page).toBe(2);
    expect(result.hasNextPage).toBe(false);
    expect(requirePermission).toHaveBeenCalledWith('production_order:read');
  });
});
