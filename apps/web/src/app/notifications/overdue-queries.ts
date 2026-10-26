import type { PrismaClient } from '@prisma/client';

/**
 * Просроченные незакрытые ПЗ (ОПЭ-60, решение владельца 26.10.2026).
 *
 * Правило: срок — дата смены + 1 день (нормальный допуск), напоминание появляется
 * со **даты смены + 2 календарных дня**. Пример: смена 12-го → напоминание с 14-го.
 *
 * Никаких хранимых уведомлений и планировщика: список вычисляется при отрисовке экрана,
 * поэтому напоминание видно при каждом обновлении и «надоедает», пока ПЗ не закроют.
 */
export interface OverdueOrder {
  id: string;
  shiftNumber: number;
  shiftDate: Date;
  status: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Полночь дня, отстоящего от сегодняшнего на `days` дней назад (по местному времени). */
export function startOfDayDaysAgo(days: number, now: Date = new Date()): Date {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return date;
}

/**
 * Через сколько календарных дней от даты смены появляется напоминание.
 *
 * По умолчанию 2 (решение владельца 26.10.2026). Переменная нужна, чтобы увидеть полосу
 * сразу на стенде: `OVERDUE_REMINDER_DAYS=0` покажет её по любому незакрытому ПЗ,
 * не дожидаясь двух суток. На проде переменная не задана — там правило по умолчанию.
 */
export function reminderThresholdDays(): number {
  const raw = Number(process.env.OVERDUE_REMINDER_DAYS ?? 2);
  return Number.isFinite(raw) && raw >= 0 ? raw : 2;
}

export async function getOverdueOrders(
  client: PrismaClient,
  now: Date = new Date(),
): Promise<OverdueOrder[]> {
  const threshold = startOfDayDaysAgo(reminderThresholdDays(), now);

  const orders = await client.productionOrder.findMany({
    where: {
      // Закрытые и отменённые не напоминают о себе.
      status: { notIn: ['COMPLETED', 'CANCELLED'] },
      shift: { date: { lte: threshold } },
    },
    orderBy: [{ shift: { date: 'asc' } }, { createdAt: 'asc' }],
    take: 50,
    select: {
      id: true,
      status: true,
      shift: { select: { number: true, date: true } },
    },
  });

  return orders.map((order) => ({
    id: order.id,
    status: order.status,
    shiftNumber: order.shift.number,
    shiftDate: order.shift.date,
  }));
}

/** Сколько календарных дней прошло с даты смены (для подписи «висит N дней»). */
export function daysSinceShift(shiftDate: Date, now: Date = new Date()): number {
  const shift = new Date(shiftDate);
  shift.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - shift.getTime()) / DAY_MS);
}
