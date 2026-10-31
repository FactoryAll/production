import type { PrismaClient } from '@prisma/client';
import type { ReportPeriod } from './period';

/**
 * Отчёт «Выработка по сотрудникам» (T-097, постановка `docs/report_employee_output.md`).
 *
 * Что считаем и почему именно так:
 *
 * 1. **Единица** — строка факта (`ProductionFact`): ПЗ → строка РЦ → категория → количество.
 *    Категории в разных единицах (Масса кг, ГП и ПФ шт), поэтому выпуск **по категориям**,
 *    а не одним числом: складывать килограммы со штуками нельзя.
 * 2. **Оператор** получает факт своей строки **один к одному** — сумма по операторам сходится
 *    с суммой фактов их строк (проверяемое свойство, закреплено тестом).
 * 3. **Работник** (фактический состав, `ProductionFactWorker.worked = true`) получает **весь
 *    выпуск строки**, где он был в составе (решение владельца, вариант A). Вклад человека
 *    в строку системой не измеряется — нет ни доли, ни персональных часов, — поэтому делить
 *    выпуск на число работников значило бы придумать вклад. Следствие: **сумма по работникам
 *    больше общего выпуска**, потому что один факт зачтён нескольким участникам. Это свойство
 *    правила, а не ошибка расчёта, и оно объясняется в интерфейсе.
 * 4. **Без персональной привязки** — отдельная строка в каждом блоке: факты строк, где нет
 *    оператора (для блока операторов) и где нет ни одного вышедшего работника (для блока
 *    работников). Без неё итог по людям «молча не сходится» и это искали бы как дефект.
 * 5. **Брак** — отдельной колонкой по категориям, **не вычитается** из выпуска: в системе
 *    `quantity` и `defectQuantity` хранятся раздельно, склад принимает `quantity`, и «Выпуск
 *    по РЦ» (T-095) тоже показывает их отдельно.
 * 6. **Отменённые ПЗ** не входят (строки не выполнялись). **Незакрытые** с фактом входят:
 *    факт — уже произошедшая работа, закрытие документа — вопрос T-100.
 */

export type OutputBlock = 'OPERATOR' | 'WORKER';

export const UNATTRIBUTED_NAME = 'Без персональной привязки';

/** Значение по трём категориям: Масса (кг), ГП и ПФ (шт). */
export interface CategoryValue {
  mass: number;
  gp: number;
  pf: number;
}

export interface EmployeeOutputRow {
  block: OutputBlock;
  /** null — строка «Без персональной привязки». */
  employeeId: string | null;
  employeeName: string;
  tabNumber: string | null;
  /** Выпуск по категориям. */
  output: CategoryValue;
  /** Брак по категориям — отдельно, из выпуска не вычитается. */
  defect: CategoryValue;
  /** Сколько разных строк ПЗ дали этот выпуск. */
  lines: number;
  /** Сколько разных ПЗ. */
  orders: number;
}

export interface EmployeeOutputTotals {
  output: CategoryValue;
  defect: CategoryValue;
  lines: number;
  orders: number;
}

export interface EmployeeOutputReport {
  /** Сначала блок операторов, затем работников; в каждом — люди, последней строка без привязки. */
  rows: EmployeeOutputRow[];
  /** Итог блока операторов: он же сумма по операторам плюс «без привязки». */
  operatorTotals: EmployeeOutputTotals;
  /**
   * Итог блока работников — **весь выпуск периода**, а не сумма по людям: один факт зачтён
   * нескольким работникам, поэтому сумма по строкам больше этого итога.
   */
  workerTotals: EmployeeOutputTotals;
}

interface FactRow {
  factCategory: string;
  quantity: { toString(): string };
  defectQuantity: { toString(): string };
  line: {
    id: string;
    operatorId: string | null;
    operator: { id: string; fullName: string; tabNumber: string } | null;
    orderId: string;
    order: { id: string; status: string };
  };
  factWorkers: Array<{
    employee: { id: string; fullName: string; tabNumber: string };
  }>;
}

function toNumber(value: { toString(): string }): number {
  return Number(value.toString());
}

function emptyValue(): CategoryValue {
  return { mass: 0, gp: 0, pf: 0 };
}

function addToValue(value: CategoryValue, category: string, quantity: number): void {
  if (category === 'MASS') {
    value.mass += quantity;
  } else if (category === 'GP') {
    value.gp += quantity;
  } else if (category === 'PF') {
    value.pf += quantity;
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function normalize(value: CategoryValue): CategoryValue {
  return { mass: round(value.mass), gp: round(value.gp), pf: round(value.pf) };
}

interface Accumulator {
  row: EmployeeOutputRow;
  lineIds: Set<string>;
  orderIds: Set<string>;
}

function createAccumulator(
  block: OutputBlock,
  employee: { id: string; fullName: string; tabNumber: string } | null,
): Accumulator {
  return {
    row: {
      block,
      employeeId: employee?.id ?? null,
      employeeName: employee?.fullName ?? UNATTRIBUTED_NAME,
      tabNumber: employee?.tabNumber ?? null,
      output: emptyValue(),
      defect: emptyValue(),
      lines: 0,
      orders: 0,
    },
    lineIds: new Set<string>(),
    orderIds: new Set<string>(),
  };
}

function accumulate(accumulator: Accumulator, fact: FactRow): void {
  const quantity = toNumber(fact.quantity);
  const defect = toNumber(fact.defectQuantity);

  addToValue(accumulator.row.output, fact.factCategory, quantity);
  // Брак — отдельной колонкой: из выпуска не вычитаем (T-095 считает так же).
  addToValue(accumulator.row.defect, fact.factCategory, defect);

  // Строка ПЗ — единица счёта «строк с участием»: у неё может быть два факта (ГП и ПФ).
  accumulator.lineIds.add(fact.line.id);
  accumulator.orderIds.add(fact.line.orderId);
}

function totalsFrom(facts: FactRow[]): EmployeeOutputTotals {
  // Итог блока — по фактам периода, а не по строкам людей: у работников один факт
  // зачтён нескольким, и сумма по строкам была бы больше выпуска.
  const output = emptyValue();
  const defect = emptyValue();
  const lines = new Set<string>();
  const orders = new Set<string>();

  for (const fact of facts) {
    addToValue(output, fact.factCategory, toNumber(fact.quantity));
    addToValue(defect, fact.factCategory, toNumber(fact.defectQuantity));
    lines.add(fact.line.id);
    orders.add(fact.line.orderId);
  }

  return {
    output: normalize(output),
    defect: normalize(defect),
    lines: lines.size,
    orders: orders.size,
  };
}

/** Доля брака к выпуску по категории; null — выпуска по категории не было. */
export function defectSharePercent(output: CategoryValue, defect: CategoryValue): CategoryValue | null {
  if (output.mass === 0 && output.gp === 0 && output.pf === 0) {
    return null;
  }
  const share = (produced: number, rejected: number): number =>
    produced > 0 ? round((rejected / produced) * 100) : 0;
  return {
    mass: share(output.mass, defect.mass),
    gp: share(output.gp, defect.gp),
    pf: share(output.pf, defect.pf),
  };
}

export async function getEmployeeOutputReport(
  client: Pick<PrismaClient, 'productionFact'>,
  period: ReportPeriod,
  filter: { workCenterId?: string } = {},
): Promise<EmployeeOutputReport> {
  const facts = (await client.productionFact.findMany({
    where: {
      line: {
        // Отменённые ПЗ в отчёт не входят: строки не выполнялись.
        order: { status: { not: 'CANCELLED' }, shift: { date: { gte: period.from, lte: period.to } } },
        ...(filter.workCenterId ? { workCenterId: filter.workCenterId } : {}),
      },
    },
    select: {
      factCategory: true,
      quantity: true,
      defectQuantity: true,
      line: {
        select: {
          id: true,
          operatorId: true,
          operator: { select: { id: true, fullName: true, tabNumber: true } },
          orderId: true,
          order: { select: { id: true, status: true } },
        },
      },
      factWorkers: {
        where: { worked: true },
        select: { employee: { select: { id: true, fullName: true, tabNumber: true } } },
      },
    },
  })) as FactRow[];

  const operators = new Map<string, Accumulator>();
  const workers = new Map<string, Accumulator>();
  // Строки «Без персональной привязки»: без оператора и без вышедших работников.
  const operatorUnattributed = createAccumulator('OPERATOR', null);
  const workerUnattributed = createAccumulator('WORKER', null);

  for (const fact of facts) {
    // Блок операторов: факт принадлежит оператору своей строки.
    if (fact.line.operator) {
      const key = fact.line.operator.id;
      const accumulator = operators.get(key) ?? createAccumulator('OPERATOR', fact.line.operator);
      accumulate(accumulator, fact);
      operators.set(key, accumulator);
    } else {
      accumulate(operatorUnattributed, fact);
    }

    // Блок работников: весь выпуск строки — каждому, кто в ней вышел (вариант A).
    if (fact.factWorkers.length > 0) {
      for (const factWorker of fact.factWorkers) {
        const key = factWorker.employee.id;
        const accumulator = workers.get(key) ?? createAccumulator('WORKER', factWorker.employee);
        // Один работник в двух фактах одной строки (ГП и ПФ) — по-прежнему одна строка.
        accumulate(accumulator, fact);
        workers.set(key, accumulator);
      }
    } else {
      accumulate(workerUnattributed, fact);
    }
  }

  const buildBlock = (accumulators: Map<string, Accumulator>, unattributed: Accumulator) => {
    const built = [...accumulators.values()].map((accumulator) => ({
      ...accumulator.row,
      output: normalize(accumulator.row.output),
      defect: normalize(accumulator.row.defect),
      lines: accumulator.lineIds.size,
      orders: accumulator.orderIds.size,
    }));

    // «Кто больше выпускает» — поэтому по убыванию ГП, затем ПФ, затем по ФИО.
    built.sort((a, b) => b.output.gp - a.output.gp || b.output.pf - a.output.pf || a.employeeName.localeCompare(b.employeeName, 'ru'));

    const anonymous =
      unattributed.lineIds.size > 0 || unattributed.orderIds.size > 0
        ? {
            ...unattributed.row,
            output: normalize(unattributed.row.output),
            defect: normalize(unattributed.row.defect),
            lines: unattributed.lineIds.size,
            orders: unattributed.orderIds.size,
          }
        : null;

    return { built, anonymous };
  };

  const operatorBlock = buildBlock(operators, operatorUnattributed);
  const workerBlock = buildBlock(workers, workerUnattributed);

  return {
    rows: [
      ...operatorBlock.built,
      ...(operatorBlock.anonymous ? [operatorBlock.anonymous] : []),
      ...workerBlock.built,
      ...(workerBlock.anonymous ? [workerBlock.anonymous] : []),
    ],
    operatorTotals: totalsFrom(facts),
    workerTotals: totalsFrom(facts),
  };
}

/**
 * Пояснение под таблицей — одна строка, которую видит пользователь.
 *
 * Сумма по работникам не равна общему выпуску, потому что один факт зачтён каждому участнику
 * строки. Написать это в интерфейсе дешевле, чем объяснять в переписке (решение владельца
 * 31.10.2026).
 */
export const WORKERS_SUM_NOTE =
  'Сумма по работникам больше общего выпуска: один факт зачтён каждому работнику, который был в составе строки. Вклад отдельного работника в строку система не измеряет, поэтому выпуск строки не делится между людьми.';
