// Смена как данные, а не как справочник, который ведут руками (T-075, решение владельца 06.10.2026).
//
// В форме ПЗ НП выбирает дату смены и её номер (1-я или 2-я), а запись смены система создаёт
// сама — идемпотентно, по уникальности (number, date). Расписание смен задано Р-05:
// 1-я 08:00–20:00, 2-я 20:00–08:00 следующего дня; дата смены — день её начала.

import type { PrismaClient } from '@prisma/client';
import type { TxClient } from './kernel';

export interface ShiftTarget {
  /** Календарная дата смены (день начала) в формате YYYY-MM-DD. */
  dateKey: string;
  /** Номер смены: 1 или 2 (Р-05). */
  number: number;
}

/** Расписание смен (Р-05). */
export const SHIFT_TIMES: Record<number, { start: string; end: string }> = {
  1: { start: '08:00', end: '20:00' },
  2: { start: '20:00', end: '08:00' },
};

/** Номер текущей смены по Р-05: 1 — 08:00–20:00, 2 — 20:00–08:00. */
export function currentShiftNumber(now: Date): number {
  const hours = now.getHours();
  return hours >= 8 && hours < 20 ? 1 : 2;
}

/**
 * Календарная дата текущей смены — день, в который она началась.
 *
 * 1-я смена (08:00–20:00) и 2-я до полуночи начинаются сегодня; 2-я смена после полуночи
 * (00:00–08:00) началась вчера, поэтому и дата у неё вчерашняя.
 */
export function currentShiftDateKey(now: Date): string {
  const start = new Date(now);
  if (now.getHours() < 8) {
    start.setDate(start.getDate() - 1);
  }
  return localDateKey(start);
}

/**
 * План нельзя поставить на прошедшую смену: она уже отработана, исполнить задание некому.
 *
 * Разрешено всё, начиная с текущей смены: днём это сегодняшняя дата, а во время ночной смены
 * после полуночи — вчерашняя, потому что такая смена ещё идёт.
 */
export function assertShiftDateNotPast(target: ShiftTarget, now: Date): void {
  if (target.dateKey < currentShiftDateKey(now)) {
    throw new Error('Дата смены не может быть раньше текущей смены');
  }
}

/** Календарная дата локального момента — то, что видит пользователь на экране. */
export function localDateKey(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Значение для колонки @db.Date: полночь UTC от календарной даты. */
export function shiftDateColumn(dateKey: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/** Разбор выбора из формы ПЗ: дата и номер смены. */
export function parseShiftTarget(dateValue: string, numberValue: string | number): ShiftTarget {
  const dateKey = String(dateValue ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new Error('Укажите дату смены');
  }
  const number = Number(numberValue);
  if (number !== 1 && number !== 2) {
    throw new Error('Смена указывается как 1 или 2');
  }
  return { dateKey, number };
}

/**
 * Смена на указанную дату и номер: находит существующую или создаёт новую.
 *
 * Идемпотентность обеспечивает уникальность (number, date) в схеме, поэтому повторное
 * сохранение ПЗ на ту же смену не создаёт дубль.
 */
export async function resolveShiftId(
  client: TxClient | PrismaClient,
  target: ShiftTarget,
): Promise<string> {
  const date = shiftDateColumn(target.dateKey);
  const times = SHIFT_TIMES[target.number];
  const shift = await client.shift.upsert({
    where: { number_date: { number: target.number, date } },
    update: {},
    create: { number: target.number, date, start: times.start, end: times.end, active: true },
  });
  return shift.id;
}
