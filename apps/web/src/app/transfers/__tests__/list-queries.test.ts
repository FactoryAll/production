import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@prodtrack/db';

vi.mock('@prodtrack/db', () => ({
  prisma: { goodsTransfer: { findMany: vi.fn() } },
}));

// Проверка права в запросе — защита в глубину: подменяем, чтобы не требовался request scope.
vi.mock('@/lib/auth/access', () => ({
  requirePermission: vi.fn().mockResolvedValue({ userId: 'user-1' }),
  requireAnyPermission: vi.fn().mockResolvedValue({ userId: 'user-1' }),
}));

import {
  getTransfersPage,
  parseTransferStatusFilter,
  TRANSFERS_PAGE_SIZE,
  transferWhere,
} from '../queries';
import { requireAnyPermission } from '@/lib/auth/access';

describe('список Перемещений: серверный фильтр и пагинация (T-057/T-058)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('распознаёт только допустимые статусы', () => {
    expect(parseTransferStatusFilter('DISCREPANCY')).toBe('DISCREPANCY');
    expect(parseTransferStatusFilter('nope')).toBe('ALL');
  });

  it('фильтр «все» не накладывает условий', () => {
    expect(transferWhere({ status: 'ALL' })).toEqual({});
  });

  it('фильтрует по статусу и берёт страницу', async () => {
    (prisma.goodsTransfer.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await getTransfersPage({ status: 'SUBMITTED' }, '3');

    expect(prisma.goodsTransfer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'SUBMITTED' },
        orderBy: { createdAt: 'desc' },
        skip: TRANSFERS_PAGE_SIZE * 2,
        take: TRANSFERS_PAGE_SIZE + 1,
      }),
    );
    expect(requireAnyPermission).toHaveBeenCalledWith(['transfer:read']);
  });
});
