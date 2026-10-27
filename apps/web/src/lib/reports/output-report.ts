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
 * Процент выполнения считается по «основному» выпуску РЦ: у РЦ, производящего Массу,
 * это Масса, у остальных — ГП. Полуфабрикат показывается отдельной колонкой: он не
 * планируется в ПЗ отдельной строкой, а является частью выпуска ГП-РЦ.
 */
export interface OutputReportRow {
  workCenterCode: string;
  workCenterName: string;
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

export async function getOutputReport(
  client: PrismaClient,
  period: ReportPeriod,
): Promise<OutputReport> {
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
      product: { select: { category: true } },
      facts: {
        select: { factCategory: true, quantity: true, defectQuantity: true },
      },
    },
  });

  const byWorkCenter = new Map<string, OutputReportRow & { producesMass: boolean }>();

  for (const line of lines) {
    const key = line.workCenter.code;
    const row =
      byWorkCenter.get(key) ??
      {
        workCenterCode: line.workCenter.code,
        workCenterName: line.workCenter.name,
        plannedMass: 0,
        plannedGp: 0,
        factMass: 0,
        factPf: 0,
        factGp: 0,
        defect: 0,
        completionPercent: null,
        producesMass: line.workCenter.producesMass,
      };

    const planned = toNumber(line.plannedQuantity);
    if (line.product.category === 'MASS') {
      row.plannedMass += planned;
    } else {
      row.plannedGp += planned;
    }

    for (const fact of line.facts) {
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

    byWorkCenter.set(key, row);
  }

  const rows: OutputReportRow[] = [...byWorkCenter.values()]
    .map(({ producesMass, ...row }) => {
      const planned = producesMass ? row.plannedMass : row.plannedGp;
      const fact = producesMass ? row.factMass : row.factGp;
      return {
        ...row,
        completionPercent: planned > 0 ? Math.round((fact / planned) * 1000) / 10 : null,
      };
    })
    .sort((a, b) => a.workCenterCode.localeCompare(b.workCenterCode));

  const sum = (pick: (row: OutputReportRow) => number) => rows.reduce((total, row) => total + pick(row), 0);
  const plannedMain = rows.reduce(
    (total, row) => total + (row.plannedMass > 0 ? row.plannedMass : row.plannedGp),
    0,
  );
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
