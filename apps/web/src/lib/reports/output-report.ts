import type { PrismaClient } from '@prisma/client';
import type { ReportPeriod } from './period';

/**
 * Отчёт «Выпуск по РЦ: план и факт» (T-095, решение владельца 26.10.2026).
 *
 * За выбранный период по каждому РЦ:
 *   план  — сумма планов строк этого РЦ в ПЗ периода;
 *   факт  — сумма фактов по категориям: Масса, ПФ, ГП;
 *   брак  — сумма брака по этим же строкам.
 *
 * Разрез задаётся параметром: по РЦ (сколько выпустил цех) или по номенклатуре
 * (план и факт по ГП и ПФ) — расчёт один и тот же, меняется только группировка.
 *
 * Процент выполнения считается по «основному» выпуску: у РЦ, производящего Массу,
 * это Масса, у остальных — ГП. Полуфабрикат показывается отдельной колонкой: он не
 * планируется в ПЗ отдельной строкой, а является частью выпуска ГП-РЦ.
 */
export interface OutputReportRow {
  /** Код группы: РЦ или номенклатура — зависит от разреза отчёта. */
  code: string;
  /** Название группы. */
  name: string;
  plannedMass: number;
  plannedGp: number;
  factMass: number;
  factPf: number;
  factGp: number;
  defect: number;
  /** Процент выполнения по основному выпуску; null, если плана нет. */
  completionPercent: number | null;
}

export interface OutputReport {
  rows: OutputReportRow[];
  totals: {
    plannedMass: number;
    plannedGp: number;
    factMass: number;
    factPf: number;
    factGp: number;
    defect: number;
    completionPercent: number | null;
  };
}

function toNumber(value: { toString(): string } | number): number {
  return typeof value === 'number' ? value : Number(value.toString());
}

export type OutputGrouping = 'workCenter' | 'product';

/** Категория выпуска: без фильтра, только Масса, только ПФ или только ГП (T-102). */
export type OutputCategory = 'MASS' | 'PF' | 'GP';

export async function getOutputReport(
  client: PrismaClient,
  period: ReportPeriod,
  grouping: OutputGrouping = 'workCenter',
  options: { category?: OutputCategory } = {},
): Promise<OutputReport> {
  const category = options.category;
  const lines = await client.productionOrderLine.findMany({
    where: {
      order: {
        shift: { date: { gte: period.from, lte: period.to } },
        // Отменённые ПЗ в отчёт не попадают: их строки не выполнялись.
        status: { not: 'CANCELLED' },
      },
    },
    include: {
      workCenter: { select: { code: true, name: true, producesMass: true } },
      product: { select: { code: true, name: true, category: true } },
      facts: {
        select: { factCategory: true, quantity: true, defectQuantity: true },
      },
    },
  });

  const groups = new Map<string, OutputReportRow & { producesMass: boolean }>();

  for (const line of lines) {
    // Разрез отчёта: по РЦ (план/факт производства) или по номенклатуре (план/факт по ГП и ПФ).
    const groupCode = grouping === 'product' ? line.product.code : line.workCenter.code;
    const groupName = grouping === 'product' ? line.product.name : line.workCenter.name;
    const row =
      groups.get(groupCode) ??
      {
        code: groupCode,
        name: groupName,
        plannedMass: 0,
        plannedGp: 0,
        factMass: 0,
        factPf: 0,
        factGp: 0,
        defect: 0,
        completionPercent: null,
        producesMass: line.workCenter.producesMass,
      };

    // План учитываем только у строк своей категории: у ПФ отдельного плана нет —
    // полуфабрикат является частью выпуска ГП-строки.
    const planned = toNumber(line.plannedQuantity);
    if (line.product.category === 'MASS') {
      if (!category || category === 'MASS') {
        row.plannedMass += planned;
      }
    } else if (!category || category === 'GP') {
      row.plannedGp += planned;
    }

    for (const fact of line.facts) {
      if (category && fact.factCategory !== category) {
        continue;
      }
      const quantity = toNumber(fact.quantity);
      if (fact.factCategory === 'MASS') {
        row.factMass += quantity;
      } else if (fact.factCategory === 'PF') {
        row.factPf += quantity;
      } else {
        row.factGp += quantity;
      }
      row.defect += toNumber(fact.defectQuantity);
    }

    groups.set(groupCode, row);
  }

  const rows: OutputReportRow[] = [...groups.values()]
    .map(({ producesMass, ...row }) => {
      const planned = producesMass ? row.plannedMass : row.plannedGp;
      const fact = producesMass ? row.factMass : row.factGp;
      return {
        ...row,
        completionPercent: planned > 0 ? Math.round((fact / planned) * 1000) / 10 : null,
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));

  const sum = (pick: (row: OutputReportRow) => number) => rows.reduce((total, row) => total + pick(row), 0);
  const plannedMain = rows.reduce((total, row) => total + (row.plannedMass > 0 ? row.plannedMass : row.plannedGp), 0);
  const factMain = rows.reduce(
    (total, row) => total + (row.plannedMass > 0 ? row.factMass : row.factGp),
    0,
  );

  return {
    rows,
    totals: {
      plannedMass: sum((row) => row.plannedMass),
      plannedGp: sum((row) => row.plannedGp),
      factMass: sum((row) => row.factMass),
      factPf: sum((row) => row.factPf),
      factGp: sum((row) => row.factGp),
      defect: sum((row) => row.defect),
      completionPercent: plannedMain > 0 ? Math.round((factMain / plannedMain) * 1000) / 10 : null,
    },
  };
}
