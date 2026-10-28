import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { shiftHours } from '../shift-hours';
import {
  getTimesheetReport,
  resolveTimesheetMark,
  resolveWorkerMark,
} from '../timesheet-report';
import { parseReportPeriod } from '../period';

/**
 * Табель учёта рабочего времени (T-093, постановка `docs/timesheet_design.md`).
 *
 * Проверяем то, на чём отчёт ломается тише всего:
 *   — часы смены через полночь (20:00–08:00 это 12 часов, а не минус двенадцать);
 *   — пометки клетки: у оператора «нет итога» / «за оператора» / «частично»,
 *     у работника «назначен, не работал» / «неявка» / «добавлен» / «не отмечен»;
 *   — часы не удваиваются, когда у сотрудника в смене несколько строк РЦ;
 *   — работник считается по фактическому составу факта, а не по назначению.
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

describe('пометки клетки оператора', () => {
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

describe('пометки клетки работника', () => {
  const base = {
    plannedLines: 0,
    workedLines: 0,
    absentLines: 0,
    closedWithoutWorker: 0,
    reportedLines: 0,
  };

  it('вышел по назначению — без пометки', () => {
    expect(resolveWorkerMark({ ...base, plannedLines: 1, workedLines: 1, reportedLines: 1 })).toBe(
      'NONE',
    );
  });

  it('вышел, хотя назначен не был — «добавлен»', () => {
    expect(resolveWorkerMark({ ...base, workedLines: 1, reportedLines: 1 })).toBe('ADDED');
  });

  it('не вышел по причине — «неявка» сильнее остальных случаев', () => {
    expect(resolveWorkerMark({ ...base, plannedLines: 1, absentLines: 1, reportedLines: 1 })).toBe(
      'ABSENT',
    );
  });

  it('строку закрыли без него — «не отмечен», а не «не работал»', () => {
    expect(
      resolveWorkerMark({ ...base, plannedLines: 1, closedWithoutWorker: 1, reportedLines: 1 }),
    ).toBe('NOT_IN_FACT');
  });

  it('смену не закрыли вовсе — «назначен, не работал»', () => {
    expect(resolveWorkerMark({ ...base, plannedLines: 1, reportedLines: 0 })).toBe('NO_FACT');
  });
});

interface TimesheetLineQuery {
  where: {
    order: { status: unknown; shift: { date: unknown } };
  };
}

function fakeClient(lines: unknown[]) {
  const findMany = vi.fn<(args: TimesheetLineQuery) => Promise<unknown[]>>(async () => lines);
  const client = { productionOrderLine: { findMany } } as unknown as PrismaClient;
  return { client, findMany };
}

const IVANOV = { id: 'emp-1', fullName: 'Иванов И.И.', tabNumber: '0001' };
const PETROV = { id: 'emp-2', fullName: 'Петров П.П.', tabNumber: '0002' };
const SIDOROV = { id: 'emp-3', fullName: 'Сидоров С.С.', tabNumber: '0003' };

const SHIFT_DAY = { id: 'shift-1', number: 1, date: '2026-10-26', start: '08:00', end: '20:00' };
const SHIFT_NIGHT = { id: 'shift-2', number: 2, date: '2026-10-27', start: '20:00', end: '08:00' };

interface FactWorkerInput {
  employee: { id: string; fullName: string; tabNumber: string };
  worked?: boolean;
  absenceReason?: string | null;
}

function factRow(worker: FactWorkerInput) {
  return {
    employeeId: worker.employee.id,
    worked: worker.worked ?? true,
    absenceReason: worker.absenceReason ? { name: worker.absenceReason } : null,
    employee: worker.employee,
  };
}

/** Фактический состав: список фактов линии, в каждом — строки состава. */
function factsOf(workers: FactWorkerInput[]) {
  return [{ factWorkers: workers.map(factRow) }];
}

function timesheetLine(input: {
  id: string;
  shift: { id: string; number: number; date: string; start: string; end: string };
  status: 'ASSIGNED' | 'ACCEPTED' | 'REPORTED';
  operator?: { id: string; fullName: string; tabNumber: string } | null;
  substitutionReasonId?: string | null;
  plannedWorkers?: Array<{ id: string; fullName: string; tabNumber: string }>;
  facts?: Array<{ factWorkers: ReturnType<typeof factRow>[] }>;
}) {
  return {
    id: input.id,
    status: input.status,
    substitutionReasonId: input.substitutionReasonId ?? null,
    operator: input.operator ?? null,
    workerAssignments: (input.plannedWorkers ?? []).map((employee) => ({ employee })),
    facts: input.facts ?? [],
    order: { shift: { ...input.shift, date: new Date(`${input.shift.date}T00:00:00`) } },
  };
}

function operatorLine(input: {
  id: string;
  employee: { id: string; fullName: string; tabNumber: string };
  shift: { id: string; number: number; date: string; start: string; end: string };
  status: 'ASSIGNED' | 'ACCEPTED' | 'REPORTED';
  substitutionReasonId?: string | null;
}) {
  return timesheetLine({ ...input, operator: input.employee });
}

describe('табель: сборка из источников', () => {
  const period = parseReportPeriod({ period: 'months', months: '2026-10' });

  it('берёт строки только по сменам периода и без отменённых ПЗ', async () => {
    const { client, findMany } = fakeClient([]);
    await getTimesheetReport(client, period);

    expect(findMany).toHaveBeenCalledTimes(1);
    const where = findMany.mock.calls[0][0].where;
    expect(where.order.status).toEqual({ not: 'CANCELLED' });
    expect(where.order.shift.date).toEqual({ gte: period.from, lte: period.to });
  });

  it('строит строку на пару «сотрудник × смена» и не удваивает часы', async () => {
    const { client } = fakeClient([
      operatorLine({ id: 'line-1', employee: IVANOV, shift: SHIFT_DAY, status: 'REPORTED' }),
      // Вторая строка того же оператора в той же смене: часов всё равно 12, а не 24.
      operatorLine({ id: 'line-2', employee: IVANOV, shift: SHIFT_DAY, status: 'REPORTED' }),
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
      // Часов нет: человек в смене не работал, и «12» рядом с пометкой читалось как работа.
      hours: null,
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

    // Порядок строк — по дате смены, затем по номеру, затем роль, затем ФИО.
    expect(report.rows.map((row) => row.employeeName)).toEqual(['Иванов И.И.', 'Сидоров С.С.']);
    expect(report.rows[1].hours).toBe(12);
    expect(report.totals).toEqual({ shifts: 2, hours: 24, discrepancies: 0 });
    expect(report.employees.map((item) => item.employeeName)).toEqual([
      'Иванов И.И.',
      'Сидоров С.С.',
    ]);
  });
});

describe('табель: работники по фактическому составу', () => {
  const period = parseReportPeriod({ period: 'months', months: '2026-10' });

  it('работник, отмеченный вышедшим, даёт работу и часы', async () => {
    const { client } = fakeClient([
      timesheetLine({
        id: 'line-1',
        shift: SHIFT_DAY,
        status: 'REPORTED',
        plannedWorkers: [PETROV],
        facts: factsOf([{ employee: PETROV, worked: true }]),
      }),
    ]);

    const report = await getTimesheetReport(client, period);

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({
      role: 'WORKER',
      assignmentLabel: 'да',
      factLabel: 'работал',
      mark: 'NONE',
      hours: 12,
    });
    expect(report.totals).toEqual({ shifts: 1, hours: 12, discrepancies: 0 });
  });

  it('назначенный работник незакрытой строки — «назначен, не работал» (решение владельца 28.10.2026)', async () => {
    const { client } = fakeClient([
      timesheetLine({
        id: 'line-1',
        shift: SHIFT_DAY,
        status: 'ACCEPTED',
        plannedWorkers: [PETROV],
      }),
    ]);

    const report = await getTimesheetReport(client, period);

    expect(report.rows[0]).toMatchObject({
      role: 'WORKER',
      assignmentLabel: 'да',
      factLabel: 'не работал',
      mark: 'NO_FACT',
      markLabel: 'назначен, не работал',
    });
    // Не работал — значит ни смена, ни часы в итоги не идут, но расхождение видно.
    expect(report.totals).toEqual({ shifts: 0, hours: 0, discrepancies: 1 });
  });

  it('строку закрыли без работника — «не отмечен»', async () => {
    const { client } = fakeClient([
      timesheetLine({
        id: 'line-1',
        shift: SHIFT_DAY,
        status: 'REPORTED',
        plannedWorkers: [PETROV],
        facts: factsOf([]),
      }),
    ]);

    const report = await getTimesheetReport(client, period);

    expect(report.rows[0]).toMatchObject({
      factLabel: 'не отмечен',
      mark: 'NOT_IN_FACT',
      markLabel: 'не отмечен в факте',
    });
  });

  it('неявка берёт причину из справочника и не считается работой', async () => {
    const { client } = fakeClient([
      timesheetLine({
        id: 'line-1',
        shift: SHIFT_DAY,
        status: 'REPORTED',
        plannedWorkers: [PETROV],
        facts: factsOf([{ employee: PETROV, worked: false, absenceReason: 'Болезнь' }]),
      }),
    ]);

    const report = await getTimesheetReport(client, period);

    expect(report.rows[0]).toMatchObject({
      factLabel: 'неявка (Болезнь)',
      mark: 'ABSENT',
      markLabel: 'неявка с причиной',
    });
    expect(report.totals).toEqual({ shifts: 0, hours: 0, discrepancies: 1 });
  });

  it('работник, которого не назначали, но он вышел — «добавлен»', async () => {
    const { client } = fakeClient([
      timesheetLine({
        id: 'line-1',
        shift: SHIFT_DAY,
        status: 'REPORTED',
        plannedWorkers: [],
        facts: factsOf([{ employee: SIDOROV, worked: true }]),
      }),
    ]);

    const report = await getTimesheetReport(client, period);

    expect(report.rows[0]).toMatchObject({
      employeeName: 'Сидоров С.С.',
      assignmentLabel: 'нет',
      factLabel: 'работал',
      mark: 'ADDED',
      markLabel: 'добавлен в факт',
    });
    expect(report.totals).toEqual({ shifts: 1, hours: 12, discrepancies: 1 });
  });

  it('состав, продублированный по двум фактам линии, не даёт двух смен', async () => {
    const { client } = fakeClient([
      timesheetLine({
        id: 'line-1',
        shift: SHIFT_DAY,
        status: 'REPORTED',
        plannedWorkers: [PETROV],
        // Состав относится к событию ввода итога, а фактов у линии два (ГП и ПФ):
        // даже если строки продублированы, смены и часы считаются один раз.
        facts: [
          { factWorkers: [factRow({ employee: PETROV, worked: true })] },
          { factWorkers: [factRow({ employee: PETROV, worked: true })] },
        ],
      }),
    ]);

    const report = await getTimesheetReport(client, period);

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].mark).toBe('NONE');
    expect(report.totals).toEqual({ shifts: 1, hours: 12, discrepancies: 0 });
  });

  it('строка без назначенного оператора видна отдельно и не идёт в часы (решение владельца 28.10.2026)', async () => {
    const { client } = fakeClient([
      // Ввод за Оператора по строке, где оператора не назначали: приписать работу некому.
      timesheetLine({
        id: 'line-1',
        shift: SHIFT_DAY,
        status: 'REPORTED',
        operator: null,
        substitutionReasonId: 'sr-1',
      }),
      operatorLine({ id: 'line-2', employee: IVANOV, shift: SHIFT_DAY, status: 'REPORTED' }),
    ]);

    const report = await getTimesheetReport(client, period);

    const anonymous = report.rows.find((row) => row.employeeId === '');
    expect(anonymous).toMatchObject({
      employeeName: 'Без оператора',
      role: 'OPERATOR',
      assignmentLabel: 'нет',
      factLabel: 'за оператора',
      mark: 'NO_OPERATOR',
      markLabel: 'без оператора',
      reportedLines: 1,
    });
    // Смена без оператора не засчитывается никому, но расхождением остаётся.
    expect(report.totals).toEqual({ shifts: 1, hours: 12, discrepancies: 1 });
    expect(report.employees.map((item) => item.employeeName)).toEqual(['Иванов И.И.']);
  });

  it('у строк без засчитанной работы часы пустые, и в итоги они не идут (проверка скрина 28.10.2026)', async () => {
    const { client } = fakeClient([
      // «назначен, нет итога» у оператора
      operatorLine({ id: 'line-1', employee: IVANOV, shift: SHIFT_DAY, status: 'ACCEPTED' }),
      // «не отмечен в факте»: строку закрыли, а работника в составе нет
      timesheetLine({
        id: 'line-2',
        shift: SHIFT_DAY,
        status: 'REPORTED',
        plannedWorkers: [PETROV],
        facts: factsOf([]),
      }),
      // неявка с причиной
      timesheetLine({
        id: 'line-3',
        shift: SHIFT_NIGHT,
        status: 'REPORTED',
        plannedWorkers: [SIDOROV],
        facts: factsOf([{ employee: SIDOROV, worked: false, absenceReason: 'Прогул' }]),
      }),
    ]);

    const report = await getTimesheetReport(client, period);

    // Все три строки видны, ни у одной нет часов — и ни одна не попала в «отработано».
    expect(report.rows).toHaveLength(3);
    for (const row of report.rows) {
      expect(row.hours).toBeNull();
      expect(row.mark).not.toBe('NONE');
    }
    expect(report.totals).toEqual({ shifts: 0, hours: 0, discrepancies: 3 });
    // В итогах по сотрудникам часов тоже нет, хотя расхождения посчитаны.
    expect(report.employees.map((item) => [item.shifts, item.hours, item.discrepancies])).toEqual([
      [0, 0, 1],
      [0, 0, 1],
      [0, 0, 1],
    ]);
  });

  it('у строки без оператора часов нет: работу приписать некому', async () => {
    const { client } = fakeClient([
      timesheetLine({
        id: 'line-1',
        shift: SHIFT_DAY,
        status: 'REPORTED',
        operator: null,
        substitutionReasonId: 'sr-1',
      }),
    ]);

    const report = await getTimesheetReport(client, period);

    expect(report.rows[0]).toMatchObject({ mark: 'NO_OPERATOR', hours: null });
  });

  it('оператор и работник одной смены — две строки с разной ролью', async () => {
    const { client } = fakeClient([
      timesheetLine({
        id: 'line-1',
        shift: SHIFT_DAY,
        status: 'REPORTED',
        operator: IVANOV,
        plannedWorkers: [PETROV],
        facts: factsOf([{ employee: PETROV, worked: true }]),
      }),
    ]);

    const report = await getTimesheetReport(client, period);

    expect(report.rows.map((row) => `${row.role}:${row.employeeName}`)).toEqual([
      'OPERATOR:Иванов И.И.',
      'WORKER:Петров П.П.',
    ]);
    expect(report.totals).toEqual({ shifts: 2, hours: 24, discrepancies: 0 });
  });
});
