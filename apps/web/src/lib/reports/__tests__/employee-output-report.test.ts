import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  UNATTRIBUTED_NAME,
  WORKERS_SUM_NOTE,
  defectSharePercent,
  getEmployeeOutputReport,
} from '../employee-output-report';
import { parseReportPeriod } from '../period';

/**
 * Выработка по сотрудникам (T-097).
 *
 * Тесты фиксируют **определения**, а не цифры: единицу учёта (строка факта), зачёт оператору
 * один к одному, зачёт работнику всего выпуска строки (вариант A владельца), строку «Без
 * персональной привязки» в обоих блоках, брак отдельной колонкой и отменённые ПЗ вне отчёта.
 *
 * Отдельный тест — свойство «сумма по работникам больше общего выпуска». Это **правило**
 * варианта A, а не дефект расчёта: один факт зачтён каждому участнику строки, потому что
 * вклад человека системой не измеряется.
 */
const PERIOD = parseReportPeriod({ period: 'months', months: '2026-10', now: new Date('2026-10-20T10:00:00') });

const IVANOV = { id: 'emp-1', fullName: 'Иванов И.И.', tabNumber: '0001' };
const PETROV = { id: 'emp-2', fullName: 'Петров П.П.', tabNumber: '0002' };
const SIDOROV = { id: 'emp-3', fullName: 'Сидоров С.С.', tabNumber: '0003' };

function fact(overrides: {
  lineId?: string;
  orderId?: string;
  status?: string;
  category?: string;
  quantity?: number;
  defect?: number;
  operator?: typeof IVANOV | null;
  workers?: Array<typeof IVANOV>;
}) {
  return {
    factCategory: overrides.category ?? 'GP',
    quantity: { toString: () => String(overrides.quantity ?? 10) },
    defectQuantity: { toString: () => String(overrides.defect ?? 0) },
    line: {
      id: overrides.lineId ?? 'line-1',
      operatorId: overrides.operator?.id ?? null,
      operator: overrides.operator ?? null,
      orderId: overrides.orderId ?? 'po-1',
      order: { id: overrides.orderId ?? 'po-1', status: overrides.status ?? 'COMPLETED' },
    },
    factWorkers: (overrides.workers ?? []).map((employee) => ({ employee })),
  };
}

function fakeClient(facts: unknown[]) {
  const findMany = vi.fn().mockResolvedValue(facts);
  const client = { productionFact: { findMany } } as unknown as PrismaClient;
  return { client, findMany };
}

describe('выработка: условие выборки', () => {
  it('берёт факты по сменам периода и без отменённых ПЗ', async () => {
    const { client, findMany } = fakeClient([]);
    await getEmployeeOutputReport(client, PERIOD);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          line: {
            order: {
              status: { not: 'CANCELLED' },
              shift: { date: { gte: PERIOD.from, lte: PERIOD.to } },
            },
          },
        },
      }),
    );
  });

  it('фильтр по РЦ сужает выборку', async () => {
    const { client, findMany } = fakeClient([]);
    await getEmployeeOutputReport(client, PERIOD, { workCenterId: 'wc-03' });

    const where = (findMany.mock.calls[0][0] as { where: { line: Record<string, unknown> } }).where;
    expect(where.line).toMatchObject({ workCenterId: 'wc-03' });
  });
});

describe('выработка: операторы', () => {
  it('факт строки приписан оператору один к одному — сумма по операторам сходится', async () => {
    const { client } = fakeClient([
      fact({ lineId: 'line-1', operator: IVANOV, quantity: 10 }),
      fact({ lineId: 'line-2', operator: PETROV, quantity: 4 }),
    ]);

    const report = await getEmployeeOutputReport(client, PERIOD);
    const operators = report.rows.filter((row) => row.block === 'OPERATOR');

    expect(operators).toHaveLength(2);
    expect(operators.map((row) => [row.employeeName, row.output.gp])).toEqual([
      ['Иванов И.И.', 10],
      ['Петров П.П.', 4],
    ]);
    // Свойство 1:1: сумма по людям равна итогу блока, пока все строки с оператором.
    const sum = operators.reduce((total, row) => total + row.output.gp, 0);
    expect(sum).toBe(report.operatorTotals.output.gp);
    expect(report.operatorTotals.lines).toBe(2);
    expect(report.operatorTotals.orders).toBe(1);
  });

  it('строка без оператора попадает в «Без персональной привязки» блока операторов', async () => {
    const { client } = fakeClient([
      fact({ lineId: 'line-1', operator: IVANOV, quantity: 10 }),
      fact({ lineId: 'line-2', operator: null, quantity: 3 }),
    ]);

    const report = await getEmployeeOutputReport(client, PERIOD);
    const anonymous = report.rows.find((row) => row.block === 'OPERATOR' && row.employeeId === null);

    expect(anonymous).toMatchObject({ employeeName: UNATTRIBUTED_NAME, output: { mass: 0, gp: 3, pf: 0 } });
    // С «без привязки» сумма тоже сходится — для этого строка и нужна.
    const people = report.rows.filter((row) => row.block === 'OPERATOR' && row.employeeId !== null);
    const sum = people.reduce((total, row) => total + row.output.gp, 0) + (anonymous?.output.gp ?? 0);
    expect(sum).toBe(report.operatorTotals.output.gp);
  });
});

describe('выработка: работники (вариант A — весь выпуск строки каждому участнику)', () => {
  it('каждому работнику зачтён весь выпуск строки, даже если их двое', async () => {
    const { client } = fakeClient([
      fact({ lineId: 'line-1', operator: IVANOV, quantity: 12, workers: [PETROV, SIDOROV] }),
    ]);

    const report = await getEmployeeOutputReport(client, PERIOD);
    const workers = report.rows.filter((row) => row.block === 'WORKER');

    expect(workers.map((row) => [row.employeeName, row.output.gp])).toEqual([
      ['Петров П.П.', 12],
      ['Сидоров С.С.', 12],
    ]);
    // Итог блока — выпуск периода, а не сумма по людям.
    expect(report.workerTotals.output.gp).toBe(12);
  });

  // Владелец просил оформить это как свойство, чтобы следующий читатель не принял за дефект.
  it('свойство варианта A: сумма по работникам БОЛЬШЕ общего выпуска — так и задумано', async () => {
    const { client } = fakeClient([
      fact({ lineId: 'line-1', quantity: 10, workers: [PETROV, SIDOROV] }),
      fact({ lineId: 'line-2', quantity: 5, workers: [PETROV] }),
    ]);

    const report = await getEmployeeOutputReport(client, PERIOD);
    const workers = report.rows.filter((row) => row.block === 'WORKER' && row.employeeId !== null);
    const sumByPeople = workers.reduce((total, row) => total + row.output.gp, 0);

    expect(report.workerTotals.output.gp).toBe(15);
    expect(sumByPeople).toBe(25);
    expect(sumByPeople).toBeGreaterThan(report.workerTotals.output.gp);
    // Причина записана в интерфейсе одной строкой — проверяем, что текст на месте.
    expect(WORKERS_SUM_NOTE).toContain('один факт зачтён каждому работнику');
  });

  it('два факта одной строки (ГП и ПФ) не дают двух «строк с участием»', async () => {
    const { client } = fakeClient([
      fact({ lineId: 'line-1', category: 'GP', quantity: 10, workers: [PETROV] }),
      fact({ lineId: 'line-1', category: 'PF', quantity: 4, workers: [PETROV] }),
    ]);

    const report = await getEmployeeOutputReport(client, PERIOD);
    const petrov = report.rows.find((row) => row.employeeName === 'Петров П.П.');

    expect(petrov?.lines).toBe(1);
    expect(petrov?.output).toEqual({ mass: 0, gp: 10, pf: 4 });
  });

  it('строка без вышедших работников попадает в «Без персональной привязки» блока работников', async () => {
    const { client } = fakeClient([fact({ lineId: 'line-1', operator: IVANOV, quantity: 7 })]);

    const report = await getEmployeeOutputReport(client, PERIOD);
    const anonymous = report.rows.find((row) => row.block === 'WORKER' && row.employeeId === null);

    expect(anonymous).toMatchObject({ employeeName: UNATTRIBUTED_NAME, output: { mass: 0, gp: 7, pf: 0 } });
    // Оператор при этом получил свой факт в своём блоке.
    expect(report.rows.find((row) => row.block === 'OPERATOR')?.employeeName).toBe('Иванов И.И.');
  });
});

describe('выработка: категории и брак', () => {
  it('категории не складываются: Масса, ГП и ПФ отдельно', async () => {
    const { client } = fakeClient([
      fact({ lineId: 'line-1', category: 'MASS', quantity: 100, operator: IVANOV }),
      fact({ lineId: 'line-2', category: 'GP', quantity: 5, operator: IVANOV }),
      fact({ lineId: 'line-3', category: 'PF', quantity: 30, operator: IVANOV }),
    ]);

    const report = await getEmployeeOutputReport(client, PERIOD);
    expect(report.rows[0].output).toEqual({ mass: 100, gp: 5, pf: 30 });
  });

  it('брак идёт отдельной колонкой и не уменьшает выпуск', async () => {
    const { client } = fakeClient([
      fact({ lineId: 'line-1', quantity: 10, defect: 2, operator: IVANOV }),
    ]);

    const report = await getEmployeeOutputReport(client, PERIOD);
    expect(report.rows[0].output.gp).toBe(10);
    expect(report.rows[0].defect.gp).toBe(2);
    expect(report.operatorTotals.defect.gp).toBe(2);
  });

  it('доля брака считается по категории, а не по сумме разных единиц', () => {
    expect(
      defectSharePercent({ mass: 0, gp: 10, pf: 0 }, { mass: 0, gp: 2, pf: 0 }),
    ).toEqual({ mass: 0, gp: 20, pf: 0 });

    // Выпуска нет — доли нет, а не «100% брака».
    expect(defectSharePercent({ mass: 0, gp: 0, pf: 0 }, { mass: 0, gp: 0, pf: 0 })).toBeNull();
  });
});

describe('выработка: порядок и состав строк', () => {
  it('блоки идут операторы → работники, «без привязки» — последней в блоке', async () => {
    const { client } = fakeClient([
      fact({ lineId: 'line-1', operator: IVANOV, quantity: 3, workers: [PETROV] }),
      fact({ lineId: 'line-2', operator: null, quantity: 1 }),
    ]);

    const report = await getEmployeeOutputReport(client, PERIOD);
    expect(report.rows.map((row) => `${row.block}:${row.employeeName}`)).toEqual([
      'OPERATOR:Иванов И.И.',
      `OPERATOR:${UNATTRIBUTED_NAME}`,
      'WORKER:Петров П.П.',
      `WORKER:${UNATTRIBUTED_NAME}`,
    ]);
  });

  it('внутри блока — по убыванию ГП: кто больше выпускает, тот выше', async () => {
    const { client } = fakeClient([
      fact({ lineId: 'line-1', operator: PETROV, quantity: 4 }),
      fact({ lineId: 'line-2', operator: IVANOV, quantity: 9 }),
    ]);

    const report = await getEmployeeOutputReport(client, PERIOD);
    expect(
      report.rows.filter((row) => row.block === 'OPERATOR').map((row) => row.employeeName),
    ).toEqual(['Иванов И.И.', 'Петров П.П.']);
  });

  it('пустой период — пустой отчёт без падения', async () => {
    const { client } = fakeClient([]);
    const report = await getEmployeeOutputReport(client, PERIOD);

    expect(report.rows).toEqual([]);
    expect(report.operatorTotals.output).toEqual({ mass: 0, gp: 0, pf: 0 });
    expect(report.workerTotals.lines).toBe(0);
  });
});
