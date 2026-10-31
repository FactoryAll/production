/**
 * Месяцы для фильтра отчётов (решение владельца 29.10.2026).
 *
 * Список месяцев строится **от месяца первого ПЗ в базе до текущего**, а не «сегодня минус
 * четырнадцать»: как и с неделями, в фильтре не должно быть месяцев, которых нет в данных,
 * и не должно отсутствовать то, что в данных есть.
 *
 * Месяцы хранятся строками `ГГГГ-ММ` — так же, как они ходят в адресе отчёта. Выбор года
 * в форме только переключает видимые месяцы: выбранные месяцы других лет остаются в наборе.
 */

import type { PrismaClient } from '@prisma/client';
import { currentMonth } from './period';

const MONTH_KEY = /^(\d{4})-(\d{2})$/;

export function isMonthKey(value: string): boolean {
  const match = MONTH_KEY.exec(value);
  if (!match) {
    return false;
  }
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

/** Год месяца `ГГГГ-ММ`; null — строка не месяц. */
export function monthYear(month: string): number | null {
  return isMonthKey(month) ? Number(month.slice(0, 4)) : null;
}

/**
 * Все месяцы от `from` до `to` включительно, **свежие сверху** — в таком порядке они идут
 * в списке. Неверные ключи и обратный диапазон дают пустой список.
 */
export function monthRange(from: string, to: string): string[] {
  if (!isMonthKey(from) || !isMonthKey(to) || from > to) {
    return [];
  }

  const months: string[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const lastYear = Number(to.slice(0, 4));
  const lastMonth = Number(to.slice(5, 7));

  // Предохранитель от бесконечного цикла на испорченных данных: 200 лет месяцев хватает.
  for (let guard = 0; guard < 2400; guard += 1) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    months.push(key);
    if (year === lastYear && month === lastMonth) {
      break;
    }
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return months.reverse();
}

/** Годы, в которых есть месяцы из набора: свежие сверху. */
export function yearsOf(months: string[]): number[] {
  const years = new Set<number>();
  for (const month of months) {
    const year = monthYear(month);
    if (year !== null) {
      years.add(year);
    }
  }
  return [...years].sort((a, b) => b - a);
}

/** Месяцы одного года в том же порядке, в котором они пришли. */
export function monthsOfYear(months: string[], year: number): string[] {
  return months.filter((month) => monthYear(month) === year);
}

/**
 * Год, который открывается в форме: текущий (решение владельца). Если текущего года
 * в данных нет, берётся самый свежий доступный — иначе список месяцев был бы пустым.
 */
export function defaultMonthYear(months: string[], now: Date = new Date()): number {
  const currentYear = now.getFullYear();
  const years = yearsOf(months);
  if (years.length === 0) {
    return currentYear;
  }
  return years.includes(currentYear) ? currentYear : years[0];
}

/**
 * Список месяцев для фильтра по датам ПЗ: от месяца первого ПЗ до текущего месяца.
 *
 * Месяц берётся по **дате смены** ПЗ, а не по времени создания записи: отчёты фильтруют
 * по дате смены, и месяц, в котором нет ни одной смены, в списке был бы пустым.
 */
export async function getAvailableReportMonths(
  client: Pick<PrismaClient, 'productionOrder'>,
  now: Date = new Date(),
): Promise<string[]> {
  const firstOrder = (await client.productionOrder.findFirst({
    orderBy: { shift: { date: 'asc' } },
    select: { shift: { select: { date: true } } },
  })) as { shift: { date: Date } } | null;

  const current = currentMonth(now);
  const first = firstOrder?.shift?.date ? currentMonth(firstOrder.shift.date) : current;

  // Первый ПЗ может быть запланирован на будущее — тогда список не начинается с будущего.
  return monthRange(first > current ? current : first, current);
}
