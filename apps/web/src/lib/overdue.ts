import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Единственное правило просрочки незакрытых ПЗ (ОПЭ-60, решение владельца 26.10.2026).
 *
 * Срок — дата смены + 1 календарный день (нормальный допуск). Напоминание и просрочка
 * начинаются с **даты смены + 2 календарных дня**: смена 12-го → напоминание с 14-го.
 *
 * Почему модуль лежит в `lib`, а не рядом с напоминанием: правило читают двое — блок напоминания
 * для НП (`components/overdue-reminder.tsx`) и отчёт «Дисциплина закрытия ПЗ». Пока правило
 * жило в `app/notifications`, отчёту пришлось бы импортировать `app` из `lib`, а это неверное
 * направление зависимостей и прямое приглашение завести вторую копию правила. Вторая копия уже
 * один раз стоила нам расхождения определений (ОПЭ-70/71), поэтому здесь **один** модуль
 * и **один** фильтр выборки на обоих потребителей.
 *
 * Никаких хранимых уведомлений и планировщика: список вычисляется при отрисовке, поэтому
 * напоминание видо при каждом обновлении и «надоедает», пока ПЗ не закроют.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Через сколько календарных дней от даты смены ПЗ считается просроченным (ОПЭ-60). */
export const OVERDUE_AFTER_DAYS = 2;

export interface OverdueOrder {
  id: string;
  shiftNumber: number;
  shiftDate: Date;
  status: string;
}

/** Полночь дня, отстоящего от сегодняшнего на `days` дней назад (по местному времени). */
export function startOfDayDaysAgo(days: number, now: Date = new Date()): Date {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return date;
}

/** Сколько календарных дней прошло с даты смены (для подписи «висит N дней»). */
export function daysSinceShift(shiftDate: Date, now: Date = new Date()): number {
  const shift = new Date(shiftDate);
  shift.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - shift.getTime()) / DAY_MS);
}

/** Просрочено ли ПЗ этой смены: с даты смены прошло `OVERDUE_AFTER_DAYS` дней или больше. */
export function isOverdue(shiftDate: Date, now: Date = new Date()): boolean {
  return daysSinceShift(shiftDate, now) >= OVERDUE_AFTER_DAYS;
}

/** Граничная дата: смены с датой не позже неё просрочены. */
export function overdueThreshold(now: Date = new Date()): Date {
  return startOfDayDaysAgo(OVERDUE_AFTER_DAYS, now);
}

/**
 * Условие выборки просроченных незакрытых ПЗ — **одно** для напоминания и для отчёта.
 *
 * Именно поэтому оно функция, а не две копии `where` в двух запросах: разъехавшееся условие
 * даёт НП напоминание «с 14-го» и отчёт с другим счётом на ту же смену.
 */
export function overdueOrdersWhere(now: Date = new Date()): Prisma.ProductionOrderWhereInput {
  return {
    // Закрытые и отменённые не напоминают о себе: отмена — не работа.
    status: { notIn: ['COMPLETED', 'CANCELLED'] },
    shift: { date: { lte: overdueThreshold(now) } },
  };
}

/** Просроченные незакрытые ПЗ для напоминания НП. */
export async function getOverdueOrders(
  client: PrismaClient,
  now: Date = new Date(),
  limit = 50,
): Promise<OverdueOrder[]> {
  const orders = await client.productionOrder.findMany({
    where: overdueOrdersWhere(now),
    orderBy: [{ shift: { date: 'asc' } }, { createdAt: 'asc' }],
    take: limit,
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
