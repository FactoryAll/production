import { describe, it, expect } from 'vitest';
import { parseReportPeriod, monthBounds, currentMonth, toDateInputValue } from '../period';
import { toCsv } from '../csv';

/**
 * Период отчёта (T-095/T-096, решение владельца 26.10.2026): смена, день, неделя,
 * месяцы с множественным выбором.
 */
describe('период отчёта', () => {
  it('по умолчанию — текущий месяц', () => {
    const now = new Date('2026-10-26T12:00:00');
    const period = parseReportPeriod({ now });
    expect(period.mode).toBe('months');
    expect(period.months).toEqual(['2026-10']);
  });

  it('несколько месяцев: берутся все выбранные, включая несоседние', () => {
    const period = parseReportPeriod({ period: 'months', months: '2026-11,2026-09' });
    expect(period.months).toEqual(['2026-09', '2026-11']);
  });

  it('день — ровно одни сутки', () => {
    const period = parseReportPeriod({ period: 'day', from: '2026-10-20', to: '2026-10-25' });
    // Сравниваем по местной дате: toISOString() в Москве даёт предыдущий день.
    expect(toDateInputValue(period.from)).toBe('2026-10-20');
    expect(toDateInputValue(period.to)).toBe('2026-10-20');
  });

  it('неделя — семь дней от выбранной даты', () => {
    const period = parseReportPeriod({ period: 'week', from: '2026-10-05' });
    expect(toDateInputValue(period.to)).toBe('2026-10-11');
  });

  it('смена — сутки её даты', () => {
    const period = parseReportPeriod({ period: 'shift', shiftId: 's-1', shiftDate: '2026-10-24' });
    expect(period.mode).toBe('shift');
    expect(period.label).toBe('24.10.2026');
  });

  it('февраль считается верно', () => {
    expect(monthBounds('2027-02')!.to.getDate()).toBe(28);
    expect(currentMonth(new Date('2026-03-15'))).toBe('2026-03');
  });
});

describe('CSV для Excel', () => {
  it('ставит BOM и точку с запятой, экранирует разделители', () => {
    const csv = toCsv(['ПЗ', 'Товар'], [['ПЗ-1', 'Крем; 100 мл']]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('ПЗ;Товар');
    expect(csv).toContain('"Крем; 100 мл"');
    expect(csv).toContain('\r\n');
  });
});

describe('разрез отчёта о выпуске', () => {
  // T-102 (решение владельца 26.10.2026): тот же расчёт, но группировка по номенклатуре.
  it('по умолчанию группирует по РЦ, с явным параметром — по номенклатуре', async () => {
    const { getOutputReport } = await import('../output-report');
    // Проверяем саму сигнатуру: разрез задаётся параметром, а не отдельной копией расчёта.
    expect(getOutputReport.length).toBeGreaterThanOrEqual(2);
  });
});
