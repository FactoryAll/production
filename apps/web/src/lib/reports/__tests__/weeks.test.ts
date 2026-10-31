import { describe, it, expect } from 'vitest';
import {
  buildWeekOptions,
  isoDate,
  mondayOf,
  weekBounds,
  weekLabel,
  WEEK_OPTIONS_LIMIT,
} from '../weeks';

/**
 * Недели для фильтра отчётов (решение владельца 29.10.2026).
 *
 * Главное, что проверяем: неделя календарная (Пн–Вс), границы включают воскресенье целиком,
 * переход через месяц и год не ломает ни подпись, ни границы, а список строится по датам смен
 * и не содержит пустых недель.
 */
describe('границы недели', () => {
  it('понедельник — начало суток, воскресенье — конец суток', () => {
    // 26.10.2026 — понедельник.
    const { from, to } = weekBounds(new Date('2026-10-26T12:30:00'));

    expect(from.getDay()).toBe(1);
    expect([from.getHours(), from.getMinutes(), from.getSeconds(), from.getMilliseconds()]).toEqual([
      0, 0, 0, 0,
    ]);
    expect(isoDate(from)).toBe('2026-10-26');

    expect(to.getDay()).toBe(0);
    expect(isoDate(to)).toBe('2026-11-01');
    expect([to.getHours(), to.getMinutes(), to.getSeconds(), to.getMilliseconds()]).toEqual([
      23, 59, 59, 999,
    ]);
  });

  it('любая дата недели даёт тот же понедельник', () => {
    const monday = mondayOf(new Date('2026-10-26T00:00:00'));
    for (const day of ['2026-10-26', '2026-10-28', '2026-10-31', '2026-11-01']) {
      expect(isoDate(mondayOf(new Date(`${day}T10:00:00`)))).toBe(isoDate(monday));
    }
  });

  it('неделя через месяц: Пн в октябре, Вс в ноябре', () => {
    const { from, to } = weekBounds(new Date('2026-10-30T09:00:00'));
    expect(isoDate(from)).toBe('2026-10-26');
    expect(isoDate(to)).toBe('2026-11-01');
  });

  it('неделя через год: Пн в декабре, Вс в январе', () => {
    const { from, to } = weekBounds(new Date('2026-12-31T23:00:00'));
    expect(isoDate(from)).toBe('2026-12-28');
    expect(isoDate(to)).toBe('2027-01-03');
  });

  it('воскресенье — конец своей недели, а не начало следующей', () => {
    expect(isoDate(mondayOf(new Date('2026-11-01T23:59:00')))).toBe('2026-10-26');
  });
});

describe('подпись недели', () => {
  it('внутри одного месяца: «12–18 октября 2026»', () => {
    expect(weekLabel(new Date('2026-10-14T10:00:00'))).toBe('12–18 октября 2026');
  });

  it('через месяц: «28 сентября – 4 октября 2026»', () => {
    expect(weekLabel(new Date('2026-09-30T10:00:00'))).toBe('28 сентября – 4 октября 2026');
  });

  it('через год: «29 декабря 2025 – 4 января 2026»', () => {
    expect(weekLabel(new Date('2026-01-01T10:00:00'))).toBe('29 декабря 2025 – 4 января 2026');
  });

  it('неделя, начинающаяся 1 числа, тоже читается как неделя', () => {
    // 1 июня 2026 — понедельник.
    expect(weekLabel(new Date('2026-06-03T10:00:00'))).toBe('1–7 июня 2026');
  });
});

describe('список недель по датам смен', () => {
  it('берёт только недели, в которые есть смены: без пустых недель', () => {
    const options = buildWeekOptions([
      new Date('2026-10-26T08:00:00'),
      // Неделя 19–25 октября пропущена: смен нет, и в списке её быть не должно.
      new Date('2026-10-12T08:00:00'),
    ]);

    expect(options.map((item) => item.value)).toEqual(['2026-10-26', '2026-10-12']);
    expect(options.map((item) => item.label)).toEqual([
      '26 октября – 1 ноября 2026',
      '12–18 октября 2026',
    ]);
  });

  it('убирает дубли: несколько смен в одной неделе дают одну запись', () => {
    const options = buildWeekOptions([
      new Date('2026-10-26T08:00:00'),
      new Date('2026-10-27T20:00:00'),
      new Date('2026-10-31T20:00:00'),
    ]);

    expect(options).toHaveLength(1);
    expect(options[0]).toEqual({
      value: '2026-10-26',
      from: '2026-10-26',
      to: '2026-11-01',
      label: '26 октября – 1 ноября 2026',
    });
  });

  it('свежие недели сверху и не больше лимита', () => {
    const dates = Array.from(
      { length: 30 },
      (_, index) => new Date(2026, 0, 5 + index * 7),
    );

    const options = buildWeekOptions(dates);

    expect(options).toHaveLength(WEEK_OPTIONS_LIMIT);
    const values = options.map((item) => item.value);
    expect([...values].sort().reverse()).toEqual(values);
  });

  it('лимит можно задать', () => {
    const dates = [
      new Date('2026-10-26T08:00:00'),
      new Date('2026-10-19T08:00:00'),
      new Date('2026-10-12T08:00:00'),
    ];
    expect(buildWeekOptions(dates, { limit: 2 }).map((item) => item.value)).toEqual([
      '2026-10-26',
      '2026-10-19',
    ]);
  });

  it('пустой список дат — пустой список недель', () => {
    expect(buildWeekOptions([])).toEqual([]);
  });
});
