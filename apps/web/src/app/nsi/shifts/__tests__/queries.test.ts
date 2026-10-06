import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@prodtrack/db', () => ({
  prisma: { shift: { findMany: vi.fn() } },
}));

import { prisma } from '@prodtrack/db';
import { getShiftsPage, shiftWhere } from '../queries';

describe('Список смен: выборка (M01 §8, T-075)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.shift.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('поиск по дате в формате ГГГГ-ММ-ДД', () => {
    expect(shiftWhere({ q: '2026-10-06' })).toEqual({ date: new Date('2026-10-06') });
  });

  it('поиск по номеру смены', () => {
    expect(shiftWhere({ q: '2' })).toEqual({ number: 2 });
  });

  it('фильтр «только активные»', () => {
    expect(shiftWhere({ active: 'ACTIVE' })).toEqual({ active: true });
  });

  it('отдаёт смены вместе с числом привязанных ПЗ — экран просмотровый (T-075)', async () => {
    await getShiftsPage({}, undefined);

    expect(prisma.shift.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { _count: { select: { orders: true } } },
        orderBy: [{ date: 'desc' }, { number: 'asc' }],
      }),
    );
  });
});
