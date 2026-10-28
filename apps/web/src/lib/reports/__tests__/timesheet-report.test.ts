import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { shiftHours } from '../shift-hours';
import { getTimesheetReport, resolveTimesheetMark } from '../timesheet-report';
import { parseReportPeriod } from '../period';

/**
 * Табель учёта рабочего времени (T-093, постановка `docs/timesheet_design.md`).
 *
 * Проверяем три вещи, на которых отчёт ломается тише всего:
 *   — часы смены через полночь (20:00–08:00 это 12 часов, а не минус двенадцать);
 *   — пометки клетки (нет итога / за оператора / частично);
 *   — часы не удваиваются, когда у оператора в смене несколько строк РЦ.
 */
describe('часы смены', () => {
  it('считает обычную смену', () => {
    expect(shiftHours('08:00', '20:00')).toBe(12);
  });

  it('считает смену через полночь', () => {
    // Именно этот случай ломает наивная арифметика: конец «раньше» начала.
    expect(shiftHours('20:00', '08:00')).toBe(12);
    expect(shiftHours('22:30', '06:00')).toBe(7.5);
  });

  it('одинаковые начало и конец — сутки', () => {
    expect(shiftHours('00:00', '00:00')).toBe(24);
  });

  it('принимает время без ведущего нуля', () => {
    expect(shiftHours('8:00', '20:00')).toBe(12);
  });

  it('неразобранное время — null, а не выдуманное число', () => {
    expect(shiftHours('', '20:00')).toBeNull();
    expect(shiftHours('25:00', '10:00')).toBeNull();
    expect(shiftHours('08:00', 'скоро')).toBeNull();
  });
});

describe('пометки клетки табеля', () => {
  it('назначен, но не отчитался — «нет итога»', () => {
    expect(resolveTimesheetMark({ assignedLines: 2, reportedLines: 0, substituted: false })).toBe(
      'NO_FACT',
    );
  });

  it('итог внесли за оператора', () => {
    expect(resolveTimesheetMark({ assignedLines: 1, reportedLines: 1, substituted: true })).toBe(
      'SUBSTITUTED',
    );
  });

  it('часть строк смены не закрыта', () => {
    expect(resolveTimesheetMark({ assignedLines: 2, reportedLines: 1, substituted: false })).toBe(
      'PARTIAL',
    );
  });

  it('полный порядок — без пометки', () => {
    expect(resolveTimesheetMark({ assignedLines: 1, reportedLines: 1, substituted: false })).toBe(
      'NONE',
    );
  });
});

interface TimesheetLineQuery {
  where: {
    operatorId: unknown;
    order: { status: unknown; shift: { date: unknown } };
  };
}

function fakeClient(lines: unknown[]) {
  const findMany = vi.fn<(args: TimesheetLineQuery) => Promise<unknown[]>>(async () => lines);
  const client = { productionOrderLine: { findMany } } as unknown as PrismaClient;
  return { client, findMany };
}

function operatorLine(input: {
  id: string;
  employee: { id: string; fullName: string; tabNumber: string };
  shift: { id: string; number: number; date: string; start: string; end: string };
  status: 'ASSIGNED' | 'ACCEPTED' | 'REPORTED';
  substitutionReasonId?: string | null;
}) {
  return {
    id: input.id,
    status: input.status,
    substitutionReasonId: input.substitutionReasonId ?? null,
    operator: input.employee,
    order: { shift: { ...input.shift, date: new Date(`${input.shift.date}T00:00:00`) } },
  };
}

const IVANOV = { id: 'emp-1', fullName: 'Иванов И.И.', tabNumber: '0001' };
const PETROV = { id: 'emp-2', fullName: 'Петров П.П.', tabNumber: '0002' };
const SIDOROV = { id: 'emp-3', fullName: 'Сидоров С.С.', tabNumber: '0003' };

const SHIFT_DAY = { id: 'shift-1', number: 1, date: '2026-10-26', start: '08:00', end: '20:00' };
const SHIFT_NIGHT = { id: 'shift-2', number: 2, date: '2026-10-27', start: '20:00', end: '08:00' };

describe('табель: сборка из трёх источников', () => {
  const period = parseReportPeriod({ period: 'months', months: '2026-10' });

  it('берёт строки только по сменам периода и без отменённых ПЗ', async () => {
    const { client, findMany } = fakeClient([]);
    await getTimesheetReport(client, period);

    expect(findMany).toHaveBeenCalledTimes(1);
    const where = findMany.mock.calls[0][0].where;
    expect(where.order.status).toEqual({ not: 'CANCELLED' });
    expect(where.order.shift.date).toEqual({ gte: period.from, lte: period.to });
    expect(where.operatorId).toEqual({ not: null });
  });

  it('строит строку на пару «сотрудник × смена» и не удваивает часы', async () => {
    const { client } = fakeClient([
      operatorLine({
        id: 'line-1',
        employee: IVANOV,
        shift: SHIFT_DAY,
        status: 'REPORTED',
      }),
      // Вторая строка того же оператора в той же смене: часов всё равно 12, а не 24.
      operatorLine({
        id: 'line-2',
        employee: IVANOV,
        shift: SHIFT_DAY,
        status: 'REPORTED',
      }),
    ]);

    const report = await getTimesheetReport(client, period);

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({
      employeeId: 'emp-1',
      shiftNumber: 1,
      role: 'OPERATOR',
      hours: 12,
      assignedLines: 2,
      reportedLines: 2,
      mark: 'NONE',
      factLabel: 'отчитался',
    });
    expect(report.totals).toEqual({ shifts: 1, hours: 12, discrepancies: 0 });
  });

  it('показывает «нет итога» для незакрытой смены и не считает её отработанной', async () => {
    const { client } = fakeClient([
      operatorLine({ id: 'line-1', employee: IVANOV, shift: SHIFT_DAY, status: 'REPORTED' }),
      operatorLine({ id: 'line-2', employee: PETROV, shift: SHIFT_DAY, status: 'ACCEPTED' }),
    ]);

    const report = await getTimesheetReport(client, period);

    const petrov = report.rows.find((row) => row.employeeId === 'emp-2');
    expect(petrov).toMatchObject({
      mark: 'NO_FACT',
      factLabel: 'нет итога',
      markLabel: 'назначен, нет итога',
      hours: 12,
      reportedLines: 0,
    });
    // Смену Петрова в итоги не засчитываем: работы по ней нет.
    expect(report.totals).toEqual({ shifts: 1, hours: 12, discrepancies: 1 });
    expect(report.employees.find((item) => item.employeeId === 'emp-2')).toMatchObject({
      shifts: 0,
      hours: 0,
      discrepancies: 1,
    });
  });

  it('помечает итог, внесённый за оператора', async () => {
    const { client } = fakeClient([
      operatorLine({
        id: 'line-1',
        employee: IVANOV,
        shift: SHIFT_DAY,
        status: 'REPORTED',
        substitutionReasonId: 'sr-1',
      }),
    ]);

    const report = await getTimesheetReport(client, period);

    expect(report.rows[0]).toMatchObject({
      mark: 'SUBSTITUTED',
      factLabel: 'за оператора',
      markLabel: 'введено за оператора',
    });
    expect(report.totals.discrepancies).toBe(1);
  });

  it('ночная смена даёт часы через полночь, итоги — по сотрудникам', async () => {
    const { client } = fakeClient([
      operatorLine({ id: 'line-1', employee: IVANOV, shift: SHIFT_DAY, status: 'REPORTED' }),
      operatorLine({ id: 'line-2', employee: SIDOROV, shift: SHIFT_NIGHT, status: 'REPORTED' }),
    ]);

    const report = await getTimesheetReport(client, period);

    // Порядок строк — по дате смены, затем по номеру, затем по ФИО.
    expect(report.rows.map((row) => row.employeeName)).toEqual(['Иванов И.И.', 'Сидоров С.С.']);
    expect(report.rows[1].hours).toBe(12);
    expect(report.totals).toEqual({ shifts: 2, hours: 24, discrepancies: 0 });
    expect(report.employees.map((item) => item.employeeName)).toEqual([
      'Иванов И.И.',
      'Сидоров С.С.',
    ]);
  });
});
