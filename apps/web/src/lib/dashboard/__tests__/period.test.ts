import { describe, it, expect } from 'vitest';
import {
  currentShiftNumber,
  dashboardPeriodRange,
  parseDashboardPeriod,
  DEFAULT_DASHBOARD_PERIOD,
} from '../period';

function at(hours: number, minutes = 0): Date {
  return new Date(2026, 9, 6, hours, minutes, 0, 0);
}

describe('Период дашборда (M11 §8, решение владельца 06.10.2026)', () => {
  it('по умолчанию — текущая смена, неизвестное значение не ломает экран', () => {
    expect(DEFAULT_DASHBOARD_PERIOD).toBe('SHIFT');
    expect(parseDashboardPeriod(undefined)).toBe('SHIFT');
    expect(parseDashboardPeriod('nonsense')).toBe('SHIFT');
    expect(parseDashboardPeriod('WEEK')).toBe('WEEK');
  });

  it('текущая смена — по Р-05: 1-я 08:00–20:00', () => {
    const range = dashboardPeriodRange('SHIFT', at(10));

    expect(range.from.getHours()).toBe(8);
    expect(range.to.getHours()).toBe(20);
    expect(range.from.getDate()).toBe(6);
  });

  it('2-я смена переходит через полночь', () => {
    const range = dashboardPeriodRange('SHIFT', at(23));

    expect(range.from.getHours()).toBe(20);
    expect(range.from.getDate()).toBe(6);
    expect(range.to.getHours()).toBe(8);
    expect(range.to.getDate()).toBe(7);
  });

  it('ночью текущая смена — вторая, начавшаяся вчера', () => {
    const range = dashboardPeriodRange('SHIFT', at(3));

    expect(range.from.getHours()).toBe(20);
    expect(range.from.getDate()).toBe(5);
    expect(range.to.getDate()).toBe(6);
  });

  it('номер текущей смены определяется временем суток', () => {
    expect(currentShiftNumber(at(8))).toBe(1);
    expect(currentShiftNumber(at(19, 59))).toBe(1);
    expect(currentShiftNumber(at(20))).toBe(2);
    expect(currentShiftNumber(at(3))).toBe(2);
  });

  it('«сегодня» — календарные сутки', () => {
    const range = dashboardPeriodRange('TODAY', at(15, 30));

    expect(range.from.getHours()).toBe(0);
    expect(range.from.getDate()).toBe(6);
    expect(range.to.getDate()).toBe(7);
  });

  it('«7 дней» включает сегодняшний день', () => {
    const range = dashboardPeriodRange('WEEK', at(15));

    expect(range.from.getMonth()).toBe(8);
    expect(range.from.getDate()).toBe(30);
    expect(range.to.getDate()).toBe(7);
  });

  it('«30 дней» включает сегодняшний день', () => {
    const range = dashboardPeriodRange('MONTH', at(15));

    expect(range.from.getMonth()).toBe(8);
    expect(range.from.getDate()).toBe(7);
  });
});
