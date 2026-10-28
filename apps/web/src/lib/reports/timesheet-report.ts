import type { PrismaClient } from '@prisma/client';
import type { ReportPeriod } from './period';
import { shiftHours } from './shift-hours';

/**
 * Отчёт «Табель учёта рабочего времени» (T-093, постановка `docs/timesheet_design.md`).
 *
 * Собирается из трёх источников, которые уже есть в системе:
 *   1. **назначения** — `ProductionOrderLine.operatorId` (кто назначен на строку ПЗ);
 *   2. **факты** — `ProductionOrderLineStatus.REPORTED` (по строке внесён итог смены);
 *   3. **смены** — `Shift.start` – `Shift.end` (сколько часов в смене).
 *
 * Строка отчёта — пара «сотрудник × смена», а не «сотрудник × строка ПЗ»: у одного
 * оператора в смене бывает несколько строк РЦ, но смена у него одна, и часы за неё
 * нельзя считать дважды. Поэтому по строкам считаются счётчики, а часы берутся один раз.
 *
 * Пометки — не отдельное событие, а признак в клетке (§4 постановки): ОТК видит
 * проблемные клетки, не сверяя столбцы глазами.
 *
 * Работники (вторая категория, §5) появятся в отчёте после доработки ввода факта:
 * до неё фактического состава работников в данных нет, а показывать назначенных
 * как «работал» было бы неправдой.
 */

export type TimesheetRole = 'OPERATOR';

/** Пометка клетки табеля (§4 постановки). */
export type TimesheetMark = 'NONE' | 'NO_FACT' | 'SUBSTITUTED' | 'PARTIAL';

export interface TimesheetRow {
  employeeId: string;
  employeeName: string;
  tabNumber: string;
  shiftId: string;
  shiftDate: Date;
  shiftNumber: number;
  role: TimesheetRole;
  /** Часы смены из справочника; null — время смены не разобрано. */
  hours: number | null;
  /** Сколько строк этой смены назначено сотруднику. */
  assignedLines: number;
  /** Сколько из назначенных строк отчиталось. */
  reportedLines: number;
  mark: TimesheetMark;
  /** Готовые подписи: страница и выгрузка не должны повторять правила словами. */
  assignmentLabel: string;
  factLabel: string;
  markLabel: string;
}

export interface TimesheetEmployeeTotal {
  employeeId: string;
  employeeName: string;
  tabNumber: string;
  shifts: number;
  hours: number;
  discrepancies: number;
}

export interface TimesheetReport {
  rows: TimesheetRow[];
  totals: {
    shifts: number;
    hours: number;
    discrepancies: number;
  };
  employees: TimesheetEmployeeTotal[];
}

const FACT_LABEL: Record<TimesheetMark, string> = {
  NONE: 'отчитался',
  NO_FACT: 'нет итога',
  SUBSTITUTED: 'за оператора',
  PARTIAL: 'частично',
};

const MARK_LABEL: Record<TimesheetMark, string> = {
  NONE: '',
  NO_FACT: 'назначен, нет итога',
  SUBSTITUTED: 'введено за оператора',
  PARTIAL: 'не все строки закрыты',
};

function roundHours(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Пометка клетки по счётчикам строк смены.
 *
 * Порядок проверок важен: «нет итога» — самый тяжёлый случай (оператор был в смене,
 * но смена не закрыта), «за оператора» важнее «частично», потому что именно он
 * объясняет, почему итог есть без участия оператора.
 */
export function resolveTimesheetMark(input: {
  assignedLines: number;
  reportedLines: number;
  substituted: boolean;
}): TimesheetMark {
  if (input.assignedLines > 0 && input.reportedLines === 0) {
    return 'NO_FACT';
  }
  if (input.substituted) {
    return 'SUBSTITUTED';
  }
  if (input.reportedLines < input.assignedLines) {
    return 'PARTIAL';
  }
  return 'NONE';
}

export async function getTimesheetReport(
  client: PrismaClient,
  period: ReportPeriod,
): Promise<TimesheetReport> {
  const lines = await client.productionOrderLine.findMany({
    where: {
      operatorId: { not: null },
      order: {
        // Отменённые ПЗ в табель не попадают: их строки не выполнялись.
        status: { not: 'CANCELLED' },
        shift: { date: { gte: period.from, lte: period.to } },
      },
    },
    select: {
      id: true,
      status: true,
      substitutionReasonId: true,
      operator: { select: { id: true, fullName: true, tabNumber: true } },
      order: {
        select: {
          shift: { select: { id: true, number: true, date: true, start: true, end: true } },
        },
      },
    },
  });

  interface Accumulator {
    employeeId: string;
    employeeName: string;
    tabNumber: string;
    shiftId: string;
    shiftDate: Date;
    shiftNumber: number;
    hours: number | null;
    assignedLines: number;
    reportedLines: number;
    substituted: boolean;
  }

  const cells = new Map<string, Accumulator>();

  for (const line of lines) {
    if (!line.operator) {
      continue;
    }
    const shift = line.order.shift;
    const key = `${line.operator.id}|${shift.id}`;
    const cell =
      cells.get(key) ??
      {
        employeeId: line.operator.id,
        employeeName: line.operator.fullName,
        tabNumber: line.operator.tabNumber,
        shiftId: shift.id,
        shiftDate: shift.date,
        shiftNumber: shift.number,
        hours: shiftHours(shift.start, shift.end),
        assignedLines: 0,
        reportedLines: 0,
        substituted: false,
      };
    cell.assignedLines += 1;
    if (line.status === 'REPORTED') {
      cell.reportedLines += 1;
    }
    if (line.substitutionReasonId) {
      cell.substituted = true;
    }
    cells.set(key, cell);
  }

  const rows: TimesheetRow[] = [...cells.values()]
    .map((cell) => {
      const mark = resolveTimesheetMark(cell);
      return {
        employeeId: cell.employeeId,
        employeeName: cell.employeeName,
        tabNumber: cell.tabNumber,
        shiftId: cell.shiftId,
        shiftDate: cell.shiftDate,
        shiftNumber: cell.shiftNumber,
        role: 'OPERATOR' as const,
        hours: cell.hours,
        assignedLines: cell.assignedLines,
        reportedLines: cell.reportedLines,
        mark,
        assignmentLabel: 'да',
        factLabel:
          mark === 'PARTIAL'
            ? `${FACT_LABEL.PARTIAL} (${cell.reportedLines} из ${cell.assignedLines})`
            : FACT_LABEL[mark],
        markLabel: MARK_LABEL[mark],
      };
    })
    .sort((a, b) => {
      const byDate = a.shiftDate.getTime() - b.shiftDate.getTime();
      if (byDate !== 0) {
        return byDate;
      }
      if (a.shiftNumber !== b.shiftNumber) {
        return a.shiftNumber - b.shiftNumber;
      }
      return a.employeeName.localeCompare(b.employeeName, 'ru');
    });

  const byEmployee = new Map<string, TimesheetEmployeeTotal>();
  for (const row of rows) {
    const total =
      byEmployee.get(row.employeeId) ??
      {
        employeeId: row.employeeId,
        employeeName: row.employeeName,
        tabNumber: row.tabNumber,
        shifts: 0,
        hours: 0,
        discrepancies: 0,
      };
    // Сменой считаем только ту, где итог внесён: «назначен, нет итога» — это не работа.
    if (row.reportedLines > 0) {
      total.shifts += 1;
      total.hours = roundHours(total.hours + (row.hours ?? 0));
    }
    if (row.mark !== 'NONE') {
      total.discrepancies += 1;
    }
    byEmployee.set(row.employeeId, total);
  }

  const employees = [...byEmployee.values()].sort((a, b) =>
    a.employeeName.localeCompare(b.employeeName, 'ru'),
  );

  return {
    rows,
    employees,
    totals: {
      shifts: employees.reduce((sum, item) => sum + item.shifts, 0),
      hours: roundHours(employees.reduce((sum, item) => sum + item.hours, 0)),
      discrepancies: employees.reduce((sum, item) => sum + item.discrepancies, 0),
    },
  };
}
