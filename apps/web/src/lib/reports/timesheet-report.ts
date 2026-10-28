import type { PrismaClient } from '@prisma/client';
import type { ReportPeriod } from './period';
import { shiftHours } from './shift-hours';

/**
 * Отчёт «Табель учёта рабочего времени» (T-093, постановка `docs/timesheet_design.md`).
 *
 * Собирается из источников, которые уже есть в системе:
 *   1. **назначения** — `ProductionOrderLine.operatorId` (оператор) и
 *      `ProductionOrderLineWorkers` (работники, план);
 *   2. **факты** — `ProductionOrderLineStatus.REPORTED` (по строке внесён итог смены)
 *      и фактический состав `ProductionFactWorker` (выход, а не план: §5 постановки);
 *   3. **смены** — `Shift.start` – `Shift.end` (сколько часов в смене).
 *
 * Строка отчёта — тройка «сотрудник × смена × роль», а не «сотрудник × строка ПЗ»:
 * у оператора в смене бывает несколько строк РЦ, но смена одна, и часы за неё нельзя
 * считать дважды. По строкам считаются счётчики, часы берутся один раз.
 *
 * Пометки — не отдельное событие, а признак в клетке (§4 постановки): ОТК видит
 * проблемные клетки, не сверяя столбцы глазами. Для работников это «назначен, не работал»
 * (решение владельца 28.10.2026: строка без факта показывается), «неявка» с причиной
 * из справочника, «добавлен» (вышел, хотя назначен не был) и «не отмечен» (строку
 * закрыли без него).
 */

export type TimesheetRole = 'OPERATOR' | 'WORKER';

/** Пометка клетки табеля (§4 постановки). */
export type TimesheetMark =
  /** Назначен и отработал, расхождений нет. */
  | 'NONE'
  /** Назначен, но смену не закрыли: «назначен, нет итога» у оператора, «назначен, не работал» у работника. */
  | 'NO_FACT'
  /** Итог внесли за оператора (замена). */
  | 'SUBSTITUTED'
  /** Оператор закрыл не все свои строки смены. */
  | 'PARTIAL'
  /** Работник не вышел, причина взята из справочника причин неявки. */
  | 'ABSENT'
  /** Работник вышел, хотя в назначении строки его не было. */
  | 'ADDED'
  /** Строку закрыли, а работника в фактическом составе нет. */
  | 'NOT_IN_FACT'
  /** Итог внесли за Оператора по строке, где оператора не назначали (решение владельца 28.10.2026). */
  | 'NO_OPERATOR';

/** Подпись строки без оператора: сотрудника, которому приписать работу, в данных нет. */
export const NO_OPERATOR_LABEL = 'Без оператора';

export interface TimesheetRow {
  employeeId: string;
  employeeName: string;
  tabNumber: string;
  shiftId: string;
  shiftDate: Date;
  shiftNumber: number;
  role: TimesheetRole;
  /** Длительность смены из справочника; null — время смены не разобрано. */
  hours: number | null;
  /** Сколько строк этой смены назначено сотруднику. */
  assignedLines: number;
  /** Сколько из назначенных строк закрыто с его участием (факт есть). */
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

const OPERATOR_FACT_LABEL: Record<'NONE' | 'NO_FACT' | 'SUBSTITUTED' | 'PARTIAL', string> = {
  NONE: 'отчитался',
  NO_FACT: 'нет итога',
  SUBSTITUTED: 'за оператора',
  PARTIAL: 'частично',
};

const OPERATOR_MARK_LABEL: Record<'NONE' | 'NO_FACT' | 'SUBSTITUTED' | 'PARTIAL', string> = {
  NONE: '',
  NO_FACT: 'назначен, нет итога',
  SUBSTITUTED: 'введено за оператора',
  PARTIAL: 'не все строки закрыты',
};

const WORKER_ROLE_LABEL: Record<TimesheetRole, string> = {
  OPERATOR: 'Оператор',
  WORKER: 'Работник',
};

export function roleLabel(role: TimesheetRole): string {
  return WORKER_ROLE_LABEL[role];
}

function roundHours(value: number): number {
  return Math.round(value * 100) / 100;
}

interface OperatorCounters {
  assignedLines: number;
  reportedLines: number;
  substituted: boolean;
}

/**
 * Пометка клетки оператора по счётчикам строк смены.
 *
 * Порядок проверок важен: «нет итога» — самый тяжёлый случай (оператор был в смене,
 * но смена не закрыта), «за оператора» важнее «частично», потому что именно он
 * объясняет, почему итог есть без участия оператора.
 */
export function resolveTimesheetMark(input: OperatorCounters): TimesheetMark {
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

export interface WorkerCounters {
  /** Строки смены, где работник был в назначении. */
  plannedLines: number;
  /** Строки, где он отмечен вышедшим в фактическом составе. */
  workedLines: number;
  /** Строки, где он отмечен не вышедшим (с причиной из справочника). */
  absentLines: number;
  /** Закрытые строки назначения, в фактическом составе которых его нет. */
  closedWithoutWorker: number;
  /** Закрытые строки смены вообще — чтобы отличить «не работал» от «строку даже не закрыли». */
  reportedLines: number;
}

/**
 * Пометка клетки работника.
 *
 * Порядок проверок важнее самих значений: выход в факте сильнее назначения (работника могли
 * добавить), неявка сильнее «не отмечен» (причина объясняет отсутствие), а «назначен,
 * не работал» ставится только когда смену вообще не закрыли — иначе это «не отмечен».
 */
export function resolveWorkerMark(input: WorkerCounters): TimesheetMark {
  if (input.workedLines > 0) {
    return input.plannedLines > 0 ? 'NONE' : 'ADDED';
  }
  if (input.absentLines > 0) {
    return 'ABSENT';
  }
  if (input.closedWithoutWorker > 0) {
    return 'NOT_IN_FACT';
  }
  if (input.plannedLines > 0 && input.reportedLines < input.plannedLines) {
    return 'NO_FACT';
  }
  return 'NONE';
}

type ShiftInfo = {
  id: string;
  number: number;
  date: Date;
  start: string;
  end: string;
};

interface Cell {
  employeeId: string;
  employeeName: string;
  tabNumber: string;
  shift: ShiftInfo;
  role: TimesheetRole;
  operator: OperatorCounters;
  worker: WorkerCounters;
  absenceReasons: string[];
}

function factWorkerLabel(mark: TimesheetMark, reasons: string[]): string {
  switch (mark) {
    case 'NO_FACT':
      return 'не работал';
    case 'ABSENT':
      return reasons.length > 0 ? `неявка (${reasons.join(', ')})` : 'неявка';
    case 'NOT_IN_FACT':
      return 'не отмечен';
    default:
      return 'работал';
  }
}

function workerMarkLabel(mark: TimesheetMark): string {
  switch (mark) {
    case 'NO_FACT':
      return 'назначен, не работал';
    case 'ABSENT':
      return 'неявка с причиной';
    case 'ADDED':
      return 'добавлен в факт';
    case 'NOT_IN_FACT':
      return 'не отмечен в факте';
    default:
      return '';
  }
}

/** Сотрудник в фактическом составе строки (после снятия дублей по фактам линии). */
interface CompositionEntry {
  employeeId: string;
  employeeName: string;
  tabNumber: string;
  worked: boolean;
  absenceReason: string | null;
}

export async function getTimesheetReport(
  client: PrismaClient,
  period: ReportPeriod,
): Promise<TimesheetReport> {
  const lines = await client.productionOrderLine.findMany({
    where: {
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
      workerAssignments: {
        select: { employee: { select: { id: true, fullName: true, tabNumber: true } } },
      },
      facts: {
        select: {
          factWorkers: {
            select: {
              employeeId: true,
              worked: true,
              absenceReason: { select: { name: true } },
              employee: { select: { id: true, fullName: true, tabNumber: true } },
            },
          },
        },
      },
      order: {
        select: {
          shift: { select: { id: true, number: true, date: true, start: true, end: true } },
        },
      },
    },
  });

  const cells = new Map<string, Cell>();

  function cellFor(
    employee: { id: string; fullName: string; tabNumber: string },
    shift: ShiftInfo,
    role: TimesheetRole,
  ): Cell {
    const key = `${employee.id}|${shift.id}|${role}`;
    const existing = cells.get(key);
    if (existing) {
      return existing;
    }
    const created: Cell = {
      employeeId: employee.id,
      employeeName: employee.fullName,
      tabNumber: employee.tabNumber,
      shift,
      role,
      operator: { assignedLines: 0, reportedLines: 0, substituted: false },
      worker: {
        plannedLines: 0,
        workedLines: 0,
        absentLines: 0,
        closedWithoutWorker: 0,
        reportedLines: 0,
      },
      absenceReasons: [],
    };
    cells.set(key, created);
    return created;
  }

  for (const line of lines) {
    const shift = line.order.shift;
    const lineClosed = line.status === 'REPORTED';

    // --- операторы ---
    if (!line.operator && lineClosed && line.substitutionReasonId) {
      // Итог внесли за Оператора, а оператора в строке не было: приписать работу некому.
      // Показываем отдельной строкой «Без оператора» — в часы и смены она не идёт,
      // но в расхождения попадает (решение владельца 28.10.2026). Строка без оператора,
      // но и без подмены — это обычная строка работников, отдельной строки ей не нужно.
      const anonymous = cellFor(
        { id: '', fullName: NO_OPERATOR_LABEL, tabNumber: '' },
        shift,
        'OPERATOR',
      );
      anonymous.operator.reportedLines += 1;
      if (line.substitutionReasonId) {
        anonymous.operator.substituted = true;
      }
    }
    if (line.operator) {
      const cell = cellFor(line.operator, shift, 'OPERATOR');
      cell.operator.assignedLines += 1;
      if (lineClosed) {
        cell.operator.reportedLines += 1;
      }
      if (line.substitutionReasonId) {
        cell.operator.substituted = true;
      }
    }

    // --- работники ---
    // Состав пишется один раз на линию (на факт основной категории), но защищаемся
    // от дублей по фактам: берём одного сотрудника один раз, выход сильнее неявки.
    const composition = new Map<string, CompositionEntry>();
    for (const fact of line.facts) {
      for (const row of fact.factWorkers) {
        const existing = composition.get(row.employeeId);
        if (!existing) {
          composition.set(row.employeeId, {
            employeeId: row.employeeId,
            employeeName: row.employee.fullName,
            tabNumber: row.employee.tabNumber,
            worked: row.worked,
            absenceReason: row.absenceReason?.name ?? null,
          });
          continue;
        }
        if (row.worked && !existing.worked) {
          existing.worked = true;
          existing.absenceReason = null;
        }
      }
    }

    const planned = line.workerAssignments.map((item) => item.employee);
    const plannedIds = new Set(planned.map((employee) => employee.id));

    for (const employee of planned) {
      const cell = cellFor(employee, shift, 'WORKER');
      cell.worker.plannedLines += 1;
      if (lineClosed) {
        cell.worker.reportedLines += 1;
      }
      const entry = composition.get(employee.id);
      if (lineClosed && !entry) {
        cell.worker.closedWithoutWorker += 1;
      }
    }

    for (const entry of composition.values()) {
      const employee = {
        id: entry.employeeId,
        fullName: entry.employeeName,
        tabNumber: entry.tabNumber,
      };
      const cell = cellFor(employee, shift, 'WORKER');
      if (!plannedIds.has(entry.employeeId) && lineClosed) {
        cell.worker.reportedLines += 1;
      }
      if (entry.worked) {
        cell.worker.workedLines += 1;
      } else {
        cell.worker.absentLines += 1;
        if (entry.absenceReason && !cell.absenceReasons.includes(entry.absenceReason)) {
          cell.absenceReasons.push(entry.absenceReason);
        }
      }
    }
  }

  const rows: TimesheetRow[] = [...cells.values()]
    .map((cell) => {
      const hours = shiftHours(cell.shift.start, cell.shift.end);
      if (cell.role === 'OPERATOR' && cell.employeeId === '') {
        return {
          employeeId: '',
          employeeName: cell.employeeName,
          tabNumber: '',
          shiftId: cell.shift.id,
          shiftDate: cell.shift.date,
          shiftNumber: cell.shift.number,
          role: cell.role,
          hours,
          assignedLines: 0,
          reportedLines: cell.operator.reportedLines,
          mark: 'NO_OPERATOR',
          assignmentLabel: 'нет',
          factLabel: 'за оператора',
          markLabel: 'без оператора',
        } satisfies TimesheetRow;
      }

      if (cell.role === 'OPERATOR') {
        const mark = resolveTimesheetMark(cell.operator) as
          | 'NONE'
          | 'NO_FACT'
          | 'SUBSTITUTED'
          | 'PARTIAL';
        return {
          employeeId: cell.employeeId,
          employeeName: cell.employeeName,
          tabNumber: cell.tabNumber,
          shiftId: cell.shift.id,
          shiftDate: cell.shift.date,
          shiftNumber: cell.shift.number,
          role: cell.role,
          hours,
          assignedLines: cell.operator.assignedLines,
          reportedLines: cell.operator.reportedLines,
          mark: mark as TimesheetMark,
          assignmentLabel: 'да',
          factLabel:
            mark === 'PARTIAL'
              ? `${OPERATOR_FACT_LABEL.PARTIAL} (${cell.operator.reportedLines} из ${cell.operator.assignedLines})`
              : OPERATOR_FACT_LABEL[mark],
          markLabel: OPERATOR_MARK_LABEL[mark],
        } satisfies TimesheetRow;
      }

      const mark = resolveWorkerMark(cell.worker);
      return {
        employeeId: cell.employeeId,
        employeeName: cell.employeeName,
        tabNumber: cell.tabNumber,
        shiftId: cell.shift.id,
        shiftDate: cell.shift.date,
        shiftNumber: cell.shift.number,
        role: cell.role,
        hours,
        assignedLines: cell.worker.plannedLines,
        reportedLines: cell.worker.workedLines,
        mark,
        assignmentLabel: cell.worker.plannedLines > 0 ? 'да' : 'нет',
        factLabel: factWorkerLabel(mark, cell.absenceReasons),
        markLabel: workerMarkLabel(mark),
      } satisfies TimesheetRow;
    })
    .sort((a, b) => {
      const byDate = a.shiftDate.getTime() - b.shiftDate.getTime();
      if (byDate !== 0) {
        return byDate;
      }
      if (a.shiftNumber !== b.shiftNumber) {
        return a.shiftNumber - b.shiftNumber;
      }
      // Операторы идут первыми: с них начинается разбор смены.
      if (a.role !== b.role) {
        return a.role === 'OPERATOR' ? -1 : 1;
      }
      return a.employeeName.localeCompare(b.employeeName, 'ru');
    });

  const byEmployee = new Map<string, TimesheetEmployeeTotal>();
  for (const row of rows) {
    // Строку без оператора не приписываем никому: у неё нет сотрудника.
    if (row.employeeId === '') {
      continue;
    }
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
    // Сменой считаем только отработанную: «назначен, нет итога» и неявка — это не работа.
    const worked =
      row.role === 'OPERATOR' ? row.reportedLines > 0 : row.reportedLines > 0 && row.mark !== 'ABSENT';
    if (worked) {
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
      // Расхождения считаем по строкам: строка «Без оператора» не входит в итоги
      // по сотрудникам, но расхождением быть не перестаёт.
      discrepancies: rows.filter((row) => row.mark !== 'NONE').length,
    },
  };
}
