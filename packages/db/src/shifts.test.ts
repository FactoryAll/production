import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  currentShiftNumber,
  localDateKey,
  parseShiftTarget,
  resolveShiftId,
  SHIFT_TIMES,
  shiftDateColumn,
} from './shifts';

describe('Смена по дате и номеру (T-075, Р-05)', () => {
  it('календарная дата берётся по локальному времени', () => {
    expect(localDateKey(new Date(2026, 9, 6, 23, 30))).toBe('2026-10-06');
    expect(localDateKey(new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01');
  });

  it('дата для колонки @db.Date — полночь UTC от календарной даты', () => {
    expect(shiftDateColumn('2026-10-06').toISOString()).toBe('2026-10-06T00:00:00.000Z');
  });

  it('номер текущей смены определяется временем суток (Р-05)', () => {
    expect(currentShiftNumber(new Date(2026, 9, 6, 8, 0))).toBe(1);
    expect(currentShiftNumber(new Date(2026, 9, 6, 19, 59))).toBe(1);
    expect(currentShiftNumber(new Date(2026, 9, 6, 20, 0))).toBe(2);
    expect(currentShiftNumber(new Date(2026, 9, 6, 3, 0))).toBe(2);
  });

  it('расписание смен задано Р-05', () => {
    expect(SHIFT_TIMES[1]).toEqual({ start: '08:00', end: '20:00' });
    expect(SHIFT_TIMES[2]).toEqual({ start: '20:00', end: '08:00' });
  });

  it('разбирает выбор из формы и отклоняет пустую дату и неверный номер', () => {
    expect(parseShiftTarget('2026-10-06', '1')).toEqual({ dateKey: '2026-10-06', number: 1 });
    expect(parseShiftTarget('2026-10-06', 2)).toEqual({ dateKey: '2026-10-06', number: 2 });
    expect(() => parseShiftTarget('', '1')).toThrow('Укажите дату смены');
    expect(() => parseShiftTarget('06.10.2026', '1')).toThrow('Укажите дату смены');
    expect(() => parseShiftTarget('2026-10-06', '3')).toThrow('Смена указывается как 1 или 2');
  });

  it('создаёт смену на дату и номер, если её ещё нет, и повторно её не дублирует', async () => {
    const upsert = vi.fn().mockResolvedValue({ id: 'shift-1' });
    const client = { shift: { upsert } } as unknown as PrismaClient;

    const id = await resolveShiftId(client, { dateKey: '2026-10-06', number: 1 });

    expect(id).toBe('shift-1');
    expect(upsert).toHaveBeenCalledWith({
      where: { number_date: { number: 1, date: new Date('2026-10-06T00:00:00.000Z') } },
      update: {},
      create: {
        number: 1,
        date: new Date('2026-10-06T00:00:00.000Z'),
        start: '08:00',
        end: '20:00',
        active: true,
      },
    });
  });

  it('для второй смены подставляет её расписание', async () => {
    const upsert = vi.fn().mockResolvedValue({ id: 'shift-2' });
    const client = { shift: { upsert } } as unknown as PrismaClient;

    await resolveShiftId(client, { dateKey: '2026-10-06', number: 2 });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ number: 2, start: '20:00', end: '08:00' }),
      }),
    );
  });
});
