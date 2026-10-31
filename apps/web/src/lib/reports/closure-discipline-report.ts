import type { PrismaClient } from '@prisma/client';
import type { ReportPeriod } from './period';
import { daysSinceShift, isOverdue, OVERDUE_AFTER_DAYS } from '../overdue';

/**
 * Отчёт «Дисциплина закрытия ПЗ» (T-100, постановка `docs/report_closure_discipline.md`).
 *
 * Строка отчёта — **ПЗ целиком** (решение владельца 31.10.2026): вопрос дисциплины задаётся
 * про документ, а какие РЦ не отметились — видно внутри строки. Строка РЦ была бы второй доской.
 *
 * Просрочка считается **тем же правилом**, что напоминание НП: дата смены + 2 календарных дня
 * (`lib/overdue.ts`, ОПЭ-60). Отчёт не вводит своего порога — настраиваемый порог дал бы третье
 * значение «просрочки» и разошёлся бы с напоминанием.
 *
 * Отменённые ПЗ в отчёт не входят: отмена — не работа. Закрытые — тоже: отчёт про то,
 * что висит.
 */

export interface ClosureDisciplineWorkCenter {
  code: string;
  name: string;
  /** Статус строки РЦ в этом ПЗ. */
  lineStatus: string;
  reported: boolean;
}

export interface ClosureDisciplineRow {
  orderId: string;
  status: string;
  shiftNumber: number;
  shiftDate: Date;
  /** Сколько календарных дней висит ПЗ. */
  daysHanging: number;
  /** Просрочено по правилу ОПЭ-60 (два дня и больше). */
  overdue: boolean;
  linesTotal: number;
  linesReported: number;
  workCenters: ClosureDisciplineWorkCenter[];
  /** Операторы строк через запятую; null — операторов нет вовсе. */
  operators: string | null;
  /** Последнее изменение ПЗ. */
  updatedAt: Date;
}

export interface ClosureDisciplineReport {
  rows: ClosureDisciplineRow[];
  totals: {
    /** Сколько незакрытых ПЗ в периоде. */
    unclosed: number;
    /** Из них просроченных (два дня и больше). */
    overdue: number;
    /** Самый долгий срок висящего ПЗ в днях; 0 — висящих нет. */
    maxDays: number;
  };
}

interface OrderRow {
  id: string;
  status: string;
  updatedAt: Date;
  shift: { number: number; date: Date };
  lines: Array<{
    status: string;
    workCenter: { code: string; name: string };
    operator: { fullName: string } | null;
  }>;
}

export async function getClosureDisciplineReport(
  client: Pick<PrismaClient, 'productionOrder'>,
  period: ReportPeriod,
  now: Date = new Date(),
): Promise<ClosureDisciplineReport> {
  const orders = (await client.productionOrder.findMany({
    where: {
      // Закрытые и отменённые не висят: одно условие с напоминанием НП по смыслу,
      // но не по дате — здесь период отчёта, а не порог просрочки.
      status: { notIn: ['COMPLETED', 'CANCELLED'] },
      shift: { date: { gte: period.from, lte: period.to } },
    },
    // Самые просроченные сверху: сортируем по дате смены по возрастанию (решение владельца).
    orderBy: [{ shift: { date: 'asc' } }, { createdAt: 'asc' }],
    select: {
      id: true,
      status: true,
      updatedAt: true,
      shift: { select: { number: true, date: true } },
      lines: {
        select: {
          status: true,
          workCenter: { select: { code: true, name: true } },
          operator: { select: { fullName: true } },
        },
      },
    },
  })) as OrderRow[];

  const rows: ClosureDisciplineRow[] = orders.map((order) => {
    const reported = order.lines.filter((line) => line.status === 'REPORTED').length;
    const operators = [
      ...new Set(order.lines.map((line) => line.operator?.fullName).filter((name): name is string => Boolean(name))),
    ];

    return {
      orderId: order.id,
      status: order.status,
      shiftNumber: order.shift.number,
      shiftDate: order.shift.date,
      daysHanging: daysSinceShift(order.shift.date, now),
      overdue: isOverdue(order.shift.date, now),
      linesTotal: order.lines.length,
      linesReported: reported,
      workCenters: order.lines.map((line) => ({
        code: line.workCenter.code,
        name: line.workCenter.name,
        lineStatus: line.status,
        reported: line.status === 'REPORTED',
      })),
      operators: operators.length > 0 ? operators.join(', ') : null,
      updatedAt: order.updatedAt,
    };
  });

  const overdueRows = rows.filter((row) => row.overdue);

  return {
    rows,
    totals: {
      unclosed: rows.length,
      overdue: overdueRows.length,
      maxDays: rows.reduce((max, row) => Math.max(max, row.daysHanging), 0),
    },
  };
}

/** Сколько дней допускается до просрочки — подпись для экрана и CSV. */
export const CLOSURE_OVERDUE_AFTER_DAYS = OVERDUE_AFTER_DAYS;
