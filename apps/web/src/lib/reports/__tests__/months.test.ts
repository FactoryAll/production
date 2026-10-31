import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  defaultMonthYear,
  getAvailableReportMonths,
  isMonthKey,
  monthRange,
  monthYear,
  monthsOfYear,
  yearsOf,
} from '../months';

/**
 * Месяцы для фильтра отчётов (решение владельца 29.10.2026).
 *
 * Список строится от месяца первого ПЗ в базе до текущего, а не «сегодня минус четырнадцать»:
 * в фильтре не должно быть месяцев без данных и не должно не хватать месяцев, которые есть.
 */

describe('месяцы как ключи ГГГГ-ММ', () => {
  it('распознаёт корректный ключ и год', () => {
    expect(isMonthKey('2026-10')).toBe(true);
    expect(monthYear('2026-10')).toBe(2026);
  });

  it('не считает месяцем мусор и несуществующий месяц', () => {
    expect(isMonthKey('2026-13')).toBe(false);
    expect(isMonthKey('2026-00')).toBe(false);
    expect(isMonthKey('октябрь')).toBe(false);
    expect(monthYear('2026-13')).toBeNull();
  });
});

describe('range месяцев', () => {
  it('идёт от первого месяца до текущего, свежие сверху', () => {
    expect(monthRange('2026-08', '2026-10')).toEqual(['2026-10', '2026-09', '2026-08']);
  });

  it('переходит через год', () => {
    expect(monthRange('2025-11', '2026-02')).toEqual([
      '2026-02',
      '2026-01',
      '2025-12',
      '2025-11',
    ]);
  });

  it('один месяц — один элемент', () => {
    expect(monthRange('2026-10', '2026-10')).toEqual(['2026-10']);
  });

  it('обратный диапазон и мусор дают пустой список', () => {
    expect(monthRange('2026-10', '2026-08')).toEqual([]);
    expect(monthRange('мусор', '2026-10')).toEqual([]);
  });
});

describe('годы и месяцы года', () => {
  const months = ['2026-10', '2026-08', '2025-12', '2025-11'];

  it('годы идут свежими сверху и без повторов', () => {
    expect(yearsOf(months)).toEqual([2026, 2025]);
  });

  it('месяцы одного года сохраняют исходный порядок', () => {
    expect(monthsOfYear(months, 2026)).toEqual(['2026-10', '2026-08']);
    expect(monthsOfYear(months, 2024)).toEqual([]);
  });

  it('по умолчанию открывается текущий год', () => {
    expect(defaultMonthYear(months, new Date('2026-10-29T10:00:00'))).toBe(2026);
  });

  it('если текущего года в данных нет — самый свежий доступный', () => {
    // Отчёт открывают в 2027, а данные кончились в декабре 2025.
    expect(defaultMonthYear(months, new Date('2027-01-05T10:00:00'))).toBe(2026);
  });

  it('пустой набор — текущий год', () => {
    expect(defaultMonthYear([], new Date('2026-10-29T10:00:00'))).toBe(2026);
  });
});

describe('список месяцев по данным', () => {
  function clientWithFirstOrder(date: Date | null) {
    const findFirst = vi.fn().mockResolvedValue(
      date ? { shift: { date } } : null,
    );
    return { client: { productionOrder: { findFirst } } as unknown as Pick<PrismaClient, 'productionOrder'>, findFirst };
  }

  it('берёт месяц первого ПЗ по дате смены', async () => {
    // Первый ПЗ — на смену 12.08.2026, значит месяцы с августа 2026 по текущий.
    const { client, findFirst } = clientWithFirstOrder(new Date('2026-08-12T08:00:00'));

    const months = await getAvailableReportMonths(client, new Date('2026-10-29T10:00:00'));

    expect(months).toEqual(['2026-10', '2026-09', '2026-08']);
    expect(findFirst).toHaveBeenCalledWith({
      orderBy: { shift: { date: 'asc' } },
      select: { shift: { select: { date: true } } },
    });
  });

  it('переходит через год: с декабря 2025 по январь 2026', async () => {
    const { client } = clientWithFirstOrder(new Date('2025-12-20T08:00:00'));

    const months = await getAvailableReportMonths(client, new Date('2026-01-10T10:00:00'));

    expect(months).toEqual(['2026-01', '2025-12']);
  });

  it('ПЗ нет — остаётся текущий месяц', async () => {
    const { client } = clientWithFirstOrder(null);

    const months = await getAvailableReportMonths(client, new Date('2026-10-29T10:00:00'));

    expect(months).toEqual(['2026-10']);
  });
});
