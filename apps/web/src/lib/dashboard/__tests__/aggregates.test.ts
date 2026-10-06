import { describe, it, expect } from 'vitest';
import { documentAgeMs, formatAge, plural, summarizeStageDurations } from '../aggregates';

describe('Возраст документа (M11 §8, M10 §5)', () => {
  const now = new Date(2026, 9, 6, 12, 0, 0);

  it('считается от последнего перехода', () => {
    const age = documentAgeMs(now, new Date(2026, 9, 6, 10, 0, 0), new Date(2026, 9, 1));

    expect(age).toBe(2 * 60 * 60 * 1000);
    expect(formatAge(age)).toBe('02:00');
  });

  it('если переходов не было — от создания документа', () => {
    const age = documentAgeMs(now, null, new Date(2026, 9, 6, 9, 30, 0));

    expect(formatAge(age)).toBe('02:30');
  });

  it('отрицательный возраст не показывается', () => {
    expect(formatAge(documentAgeMs(now, new Date(2026, 9, 6, 13, 0, 0), now))).toBe('00:00');
  });

  it('без данных — прочерк', () => {
    expect(formatAge(null)).toBe('—');
  });

  it('от суток возраст показывает дни, а не «1006:59»', () => {
    const age = documentAgeMs(now, new Date(2026, 7, 25, 12, 0, 0), now);

    expect(formatAge(age)).toBe('42 д 00:00');
  });

  it('ровно сутки — уже «день»', () => {
    expect(formatAge(24 * 60 * 60 * 1000)).toBe('1 д 00:00');
  });
});

describe('Согласование числа и существительного', () => {
  it('выбирает форму по правилам русского языка', () => {
    expect(plural(1, 'перемещение', 'перемещения', 'перемещений')).toBe('перемещение');
    expect(plural(2, 'перемещение', 'перемещения', 'перемещений')).toBe('перемещения');
    expect(plural(5, 'перемещение', 'перемещения', 'перемещений')).toBe('перемещений');
  });

  it('не ошибается на 11–14 и на круглых десятках', () => {
    expect(plural(11, 'приёмка', 'приёмки', 'приёмок')).toBe('приёмок');
    expect(plural(12, 'приёмка', 'приёмки', 'приёмок')).toBe('приёмок');
    expect(plural(21, 'приёмка', 'приёмки', 'приёмок')).toBe('приёмка');
    expect(plural(22, 'приёмка', 'приёмки', 'приёмок')).toBe('приёмки');
    expect(plural(0, 'приёмка', 'приёмки', 'приёмок')).toBe('приёмок');
    expect(plural(111, 'приёмка', 'приёмки', 'приёмок')).toBe('приёмок');
  });
});

describe('Длительности этапов за период (M11 §8, M10 §4.1)', () => {
  it('складывает одинаковые этапы и сортирует по средней длительности', () => {
    const summary = summarizeStageDurations([
      { fromStatus: 'DRAFT', toStatus: 'CONFIRMED', durationMs: 60_000 },
      { fromStatus: 'DRAFT', toStatus: 'CONFIRMED', durationMs: 180_000 },
      { fromStatus: 'CONFIRMED', toStatus: 'IN_PROGRESS', durationMs: 600_000 },
    ]);

    expect(summary).toEqual([
      {
        fromStatus: 'CONFIRMED',
        toStatus: 'IN_PROGRESS',
        count: 1,
        averageMs: 600_000,
        maxMs: 600_000,
      },
      {
        fromStatus: 'DRAFT',
        toStatus: 'CONFIRMED',
        count: 2,
        averageMs: 120_000,
        maxMs: 180_000,
      },
    ]);
  });

  it('разные этапы с одинаковой парой статусов не смешиваются по разным документам', () => {
    const summary = summarizeStageDurations([
      { fromStatus: 'SUBMITTED', toStatus: 'RECEIVED', durationMs: 1_000 },
      { fromStatus: 'SUBMITTED', toStatus: 'DISCREPANCY', durationMs: 5_000 },
    ]);

    expect(summary.map((item) => item.toStatus)).toEqual(['DISCREPANCY', 'RECEIVED']);
  });

  it('ограничивает число строк виджета', () => {
    const items = Array.from({ length: 12 }, (_, index) => ({
      fromStatus: 'S' + index,
      toStatus: 'T' + index,
      durationMs: index * 1000,
    }));

    expect(summarizeStageDurations(items, 5)).toHaveLength(5);
  });

  it('пустой список даёт пустой виджет', () => {
    expect(summarizeStageDurations([])).toEqual([]);
  });
});
