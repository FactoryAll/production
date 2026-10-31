import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { getClosureDisciplineReport } from '../closure-discipline-report';
import { getOverdueOrders, isOverdue } from '../../overdue';
import { parseReportPeriod } from '../period';

/**
 * Отчёт «Дисциплина закрытия ПЗ» (T-100).
 *
 * Владелец решил: строка — ПЗ целиком, порог — фиксированные два дня по ОПЭ-60, отменённые
 * не показываются, операторы — колонкой. Отдельно проверяется главное требование: правило
 * просрочки **одно**, и напоминание НП с отчётом дают одинаковый набор ПЗ на одну дату.
 */
const NOW = new Date('2026-10-20T12:00:00');
const PERIOD = parseReportPeriod({ period: 'months', months: '2026-10', now: NOW });

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 'po-1',
    status: 'IN_PROGRESS',
    updatedAt: new Date('2026-10-13T09:00:00'),
    shift: { number: 1, date: new Date('2026-10-12T00:00:00') },
    lines: [
      {
        status: 'REPORTED',
        workCenter: { code: '03', name: 'Тубировка крем' },
        operator: { fullName: 'Иванов И.И.' },
      },
      {
        status: 'ACCEPTED',
        workCenter: { code: '05', name: 'Линия вязк.прод' },
        operator: { fullName: 'Петров П.П.' },
      },
    ],
    ...overrides,
  };
}

/**
 * Клиент, который честно применяет условия выборки.
 *
 * Без этого проверка «правило одно» ничего не значит: мок, возвращающий всё подряд, отдал бы
 * одинаковый набор и при разных порогах. Здесь фильтруются и статус, и дата смены.
 */
interface QueryArgs {
  where?: {
    status?: { notIn?: string[] };
    shift?: { date?: { lte?: Date; gte?: Date } };
  };
}

function fakeClient(orders: Array<Record<string, unknown>>) {
  const findMany = vi.fn(async (args: QueryArgs) => {
    const notIn: string[] = args?.where?.status?.notIn ?? [];
    const bound = args?.where?.shift?.date?.lte ?? args?.where?.shift?.date?.gte;
    type OrderLike = { status: string; shift: { date: Date } };
    return orders.filter((order) => {
      const typed = order as OrderLike;
      if (notIn.includes(typed.status)) {
        return false;
      }
      if (bound && typed.shift.date.getTime() > bound.getTime()) {
        return false;
      }
      return true;
    });
  });
  const client = { productionOrder: { findMany } } as unknown as PrismaClient;
  return { client, findMany };
}

describe('дисциплина закрытия: выборка', () => {
  it('берёт только незакрытые ПЗ периода по дате смены', async () => {
    const { client, findMany } = fakeClient([]);
    await getClosureDisciplineReport(client, PERIOD, NOW);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
          shift: { date: { gte: PERIOD.from, lte: PERIOD.to } },
        },
        // Самые просроченные сверху — по дате смены по возрастанию.
        orderBy: [{ shift: { date: 'asc' } }, { createdAt: 'asc' }],
      }),
    );
  });

  it('строка ПЗ: дни, просрочка, строки, РЦ с отметками, операторы', async () => {
    const { client } = fakeClient([order()]);
    const report = await getClosureDisciplineReport(client, PERIOD, NOW);

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({
      orderId: 'po-1',
      shiftNumber: 1,
      daysHanging: 8,
      overdue: true,
      linesTotal: 2,
      linesReported: 1,
      operators: 'Иванов И.И., Петров П.П.',
    });
    expect(report.rows[0].workCenters).toEqual([
      { code: '03', name: 'Тубировка крем', lineStatus: 'REPORTED', reported: true },
      { code: '05', name: 'Линия вязк.прод', lineStatus: 'ACCEPTED', reported: false },
    ]);
  });

  it('итоги: незакрытых, просроченных, максимальный срок', async () => {
    const { client } = fakeClient([
      order({ id: 'po-old', shift: { number: 1, date: new Date('2026-10-05T00:00:00') } }),
      order({ id: 'po-fresh', shift: { number: 2, date: new Date('2026-10-20T00:00:00') } }),
    ]);

    const report = await getClosureDisciplineReport(client, PERIOD, NOW);

    expect(report.totals).toEqual({ unclosed: 2, overdue: 1, maxDays: 15 });
  });

  it('ПЗ без операторов не ломает строку', async () => {
    const { client } = fakeClient([
      order({
        lines: [
          {
            status: 'ASSIGNED',
            workCenter: { code: '07', name: 'П/авт вязк.прод' },
            operator: null,
          },
        ],
      }),
    ]);

    const report = await getClosureDisciplineReport(client, PERIOD, NOW);
    expect(report.rows[0].operators).toBeNull();
    expect(report.rows[0].linesReported).toBe(0);
  });

  it('висящих нет — нулевые итоги, а не пустота', async () => {
    const { client } = fakeClient([]);
    const report = await getClosureDisciplineReport(client, PERIOD, NOW);
    expect(report.totals).toEqual({ unclosed: 0, overdue: 0, maxDays: 0 });
  });
});

describe('правило просрочки одно на напоминание и отчёт', () => {
  it('напоминание НП и отчёт выделяют одни и те же просроченные ПЗ', async () => {
    // Одинаковые данные на обоих потребителях: одна и та же фикстура.
    const orders = [
      order({ id: 'po-1', shift: { number: 1, date: new Date('2026-10-12T00:00:00') } }),
      order({ id: 'po-2', shift: { number: 2, date: new Date('2026-10-18T00:00:00') } }),
      order({ id: 'po-3', shift: { number: 1, date: new Date('2026-10-20T00:00:00') } }),
    ];

    const reminderClient = fakeClient(orders).client;
    const reportClient = fakeClient(orders).client;

    // Напоминание выбирает само (у него порог в условии), отчёт — по периоду,
    // поэтому в тесте мы берём его строки и применяем то же правило `isOverdue`.
    const reminder = await getOverdueOrders(reminderClient, NOW);
    const report = await getClosureDisciplineReport(reportClient, PERIOD, NOW);
    const reportOverdue = report.rows.filter((row) => row.overdue);

    expect(reminder.map((item) => item.id)).toEqual(['po-1', 'po-2']);
    expect(reportOverdue.map((row) => row.orderId)).toEqual(reminder.map((item) => item.id));
    // И то же самое глазами: правило — два дня.
    expect(report.rows.map((row) => row.overdue)).toEqual(
      report.rows.map((row) => isOverdue(row.shiftDate, NOW)),
    );
  });
});
