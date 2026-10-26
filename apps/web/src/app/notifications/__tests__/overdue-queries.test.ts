import { describe, it, expect } from 'vitest';
import { daysSinceShift, startOfDayDaysAgo } from '../overdue-queries';

/**
 * ОПЭ-60 (решение владельца 26.10.2026): напоминание о незакрытых ПЗ появляется
 * со **даты смены + 2 календарных дня**. Смена 12-го → напоминание с 14-го.
 */
describe('порог напоминания о незакрытых ПЗ', () => {
  it('на 13-е смена 12-го ещё не напоминает', () => {
    const thirteenth = new Date('2026-10-13T10:00:00');
    const threshold = startOfDayDaysAgo(2, thirteenth);
    const shiftDate = new Date('2026-10-12T00:00:00');
    expect(shiftDate.getTime() <= threshold.getTime()).toBe(false);
  });

  it('на 14-е смена 12-го уже напоминает', () => {
    const fourteenth = new Date('2026-10-14T08:00:00');
    const threshold = startOfDayDaysAgo(2, fourteenth);
    const shiftDate = new Date('2026-10-12T00:00:00');
    expect(shiftDate.getTime() <= threshold.getTime()).toBe(true);
  });

  it('считает, сколько дней висит ПЗ', () => {
    const now = new Date('2026-10-15T12:00:00');
    expect(daysSinceShift(new Date('2026-10-12T00:00:00'), now)).toBe(3);
    expect(daysSinceShift(new Date('2026-10-15T00:00:00'), now)).toBe(0);
  });
});
