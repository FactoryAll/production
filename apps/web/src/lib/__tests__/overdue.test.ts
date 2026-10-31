import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  OVERDUE_AFTER_DAYS,
  daysSinceShift,
  getOverdueOrders,
  isOverdue,
  overdueOrdersWhere,
  overdueThreshold,
  startOfDayDaysAgo,
} from '../overdue';

/**
 * Правило просрочки незакрытых ПЗ (ОПЭ-60, решение владельца 26.10.2026).
 *
 * Правило одно на систему: срок — дата смены + 1 день, просрочка и напоминание — с даты
 * смены + 2 дня. Смена 12-го → напоминание с 14-го.
 */
describe('порог напоминания о незакрытых ПЗ', () => {
  it('на 13-е смена 12-го ещё не просрочена', () => {
    const thirteenth = new Date('2026-10-13T10:00:00');
    const shiftDate = new Date('2026-10-12T00:00:00');

    expect(isOverdue(shiftDate, thirteenth)).toBe(false);
    expect(shiftDate.getTime() <= overdueThreshold(thirteenth).getTime()).toBe(false);
  });

  it('на 14-е смена 12-го уже просрочена', () => {
    const fourteenth = new Date('2026-10-14T08:00:00');
    const shiftDate = new Date('2026-10-12T00:00:00');

    expect(isOverdue(shiftDate, fourteenth)).toBe(true);
    expect(shiftDate.getTime() <= overdueThreshold(fourteenth).getTime()).toBe(true);
  });

  it('порог — два календарных дня, и это одна константа на всех', () => {
    expect(OVERDUE_AFTER_DAYS).toBe(2);
    const now = new Date('2026-10-14T23:59:00');
    // Время суток не влияет: сравниваются календарные дни.
    expect(overdueThreshold(now).getDate()).toBe(12);
    expect(startOfDayDaysAgo(2, now).getTime()).toBe(overdueThreshold(now).getTime());
  });

  it('считает, сколько дней висит ПЗ', () => {
    const now = new Date('2026-10-15T12:00:00');
    expect(daysSinceShift(new Date('2026-10-12T00:00:00'), now)).toBe(3);
    expect(daysSinceShift(new Date('2026-10-15T00:00:00'), now)).toBe(0);
  });

  it('закрытые и отменённые в условие просрочки не попадают', () => {
    const where = overdueOrdersWhere(new Date('2026-10-14T10:00:00'));
    expect(where).toMatchObject({ status: { notIn: ['COMPLETED', 'CANCELLED'] } });
  });
});

describe('выборка просроченных ПЗ', () => {
  it('отдаёт номер, дату смены и статус, свежие сверху по дате смены', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'po-1',
        status: 'IN_PROGRESS',
        shift: { number: 2, date: new Date('2026-10-10T00:00:00') },
      },
    ]);
    const client = { productionOrder: { findMany } } as unknown as PrismaClient;

    const orders = await getOverdueOrders(client, new Date('2026-10-14T10:00:00'));

    expect(orders).toEqual([
      { id: 'po-1', status: 'IN_PROGRESS', shiftNumber: 2, shiftDate: new Date('2026-10-10T00:00:00') },
    ]);
    // Условие одно: оно приходит из общей функции, а не пишется здесь заново.
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: overdueOrdersWhere(new Date('2026-10-14T10:00:00')),
        orderBy: [{ shift: { date: 'asc' } }, { createdAt: 'asc' }],
      }),
    );
  });
});
