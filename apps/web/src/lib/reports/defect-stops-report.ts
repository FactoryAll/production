import type { PrismaClient } from '@prisma/client';
import type { ReportPeriod } from './period';
import { pickPrimaryFact } from '../fact-worker-composition';

/**
 * Отчёт «Брак и простои» (T-101, постановка `docs/report_defect_stops.md`).
 *
 * Два разреза на одной странице: **по РЦ** и **по причинам брака**. Плюс небольшой блок
 * простоя **по операторам** — по определению владельца простой строки приписывается её
 * оператору (он ведёт смену и вносит простой); работникам не приписывается: делить нельзя,
 * а зачитывать каждому весь простой значило бы показать один час двум людям.
 *
 * Простои **дедуплицируются по строке** через `pickPrimaryFact` — то же правило «основной факт»,
 * что у состава работников и потребления. Это нужно для старых данных: до исправления
 * (ОПЭ-73) значение писалось в каждый факт строки, и на ГП-РЦ простой лежал в обоих.
 *
 * Брак: `defectQuantity` по категории, причина — `DefectReason`; брак без причины идёт
 * отдельной строкой, иначе такая доля молча выпала бы из разреза.
 */

export type DefectStopsView = 'workCenter' | 'reason';

export const NO_REASON_LABEL = 'без причины';
export const NO_OPERATOR_LABEL = 'Без персональной привязки';

export interface CategoryValue {
  mass: number;
  gp: number;
  pf: number;
}

export interface WorkCenterDefectRow {
  code: string;
  name: string;
  output: CategoryValue;
  defect: CategoryValue;
  /** Число остановок по строкам РЦ (дедуплицировано по строке). */
  stopsCount: number;
  stopsMinutes: number;
  /** Часы простоя: минуты / 60 с одним знаком (решение владельца). */
  stopsHours: number;
  /** Сколько строк РЦ имели простой. */
  linesWithStops: number;
}

export interface ReasonDefectRow {
  /** null — брак без причины. */
  code: string | null;
  name: string;
  defect: CategoryValue;
  /** Коды РЦ, где эта причина встречалась. */
  workCenterCodes: string[];
}

export interface OperatorStopsRow {
  /** null — строка без оператора. */
  employeeId: string | null;
  employeeName: string;
  stopsMinutes: number;
  stopsHours: number;
}

export interface DefectStopsReport {
  workCenters: WorkCenterDefectRow[];
  reasons: ReasonDefectRow[];
  operatorStops: OperatorStopsRow[];
  totals: {
    output: CategoryValue;
    defect: CategoryValue;
    stopsCount: number;
    stopsMinutes: number;
    stopsHours: number;
    linesWithStops: number;
  };
}

interface FactRow {
  factCategory: string;
  quantity: { toString(): string };
  defectQuantity: { toString(): string };
  stopsCount: number;
  stopsDurationMinutes: number;
  defectReason: { code: string; name: string } | null;
  line: {
    id: string;
    operator: { id: string; fullName: string } | null;
    workCenter: { code: string; name: string };
    product: { category: string };
    orderId: string;
    order: { status: string };
  };
}

function toNumber(value: { toString(): string }): number {
  return Number(value.toString());
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Часы простоя — минуты / 60 с ОДНИМ знаком (решение владельца 31.10.2026). */
export function stopsHoursFromMinutes(minutes: number): number {
  return Math.round((minutes / 60) * 10) / 10;
}

function emptyValue(): CategoryValue {
  return { mass: 0, gp: 0, pf: 0 };
}

function addTo(value: CategoryValue, category: string, quantity: number): void {
  if (category === 'MASS') value.mass += quantity;
  else if (category === 'GP') value.gp += quantity;
  else if (category === 'PF') value.pf += quantity;
}

function normalized(value: CategoryValue): CategoryValue {
  return { mass: round(value.mass), gp: round(value.gp), pf: round(value.pf) };
}

/** Доля брака к выпуску по категории; null — выпуска не было. */
export function defectSharePercent(output: CategoryValue, defect: CategoryValue): CategoryValue | null {
  if (output.mass === 0 && output.gp === 0 && output.pf === 0) {
    return null;
  }
  const share = (produced: number, rejected: number): number =>
    produced > 0 ? round((rejected / produced) * 100) : 0;
  return { mass: share(output.mass, defect.mass), gp: share(output.gp, defect.gp), pf: share(output.pf, defect.pf) };
}

export async function getDefectStopsReport(
  client: Pick<PrismaClient, 'productionFact'>,
  period: ReportPeriod,
): Promise<DefectStopsReport> {
  const facts = (await client.productionFact.findMany({
    where: {
      line: {
        // Отменённые ПЗ не входят: строки не выполнялись.
        order: { status: { not: 'CANCELLED' }, shift: { date: { gte: period.from, lte: period.to } } },
      },
    },
    select: {
      factCategory: true,
      quantity: true,
      defectQuantity: true,
      stopsCount: true,
      stopsDurationMinutes: true,
      defectReason: { select: { code: true, name: true } },
      line: {
        select: {
          id: true,
          operator: { select: { id: true, fullName: true } },
          workCenter: { select: { code: true, name: true } },
          product: { select: { category: true } },
          orderId: true,
          order: { select: { status: true } },
        },
      },
    },
  })) as FactRow[];

  // Группируем по строке: простои берём с ОСНОВНОГО факта (pickPrimaryFact), иначе на ГП-РЦ
  // старые данные дадут двойной простой (ОПЭ-73).
  const byLine = new Map<string, FactRow[]>();
  for (const fact of facts) {
    const list = byLine.get(fact.line.id) ?? [];
    list.push(fact);
    byLine.set(fact.line.id, list);
  }

  const workCenters = new Map<string, WorkCenterDefectRow>();
  const reasons = new Map<string, ReasonDefectRow>();
  const operatorStops = new Map<string, OperatorStopsRow>();

  const totalsOutput = emptyValue();
  const totalsDefect = emptyValue();
  let totalStopsCount = 0;
  let totalStopsMinutes = 0;
  const linesWithStops = new Set<string>();

  for (const [lineId, lineFacts] of byLine) {
    const first = lineFacts[0];
    const primary = pickPrimaryFact(lineFacts, first.line.product.category);
    // Простои — только с основного факта строки.
    const stopsCount = primary?.stopsCount ?? 0;
    const stopsMinutes = primary?.stopsDurationMinutes ?? 0;

    const workCenterKey = first.line.workCenter.code;
    const workCenterRow =
      workCenters.get(workCenterKey) ??
      {
        code: first.line.workCenter.code,
        name: first.line.workCenter.name,
        output: emptyValue(),
        defect: emptyValue(),
        stopsCount: 0,
        stopsMinutes: 0,
        stopsHours: 0,
        linesWithStops: 0,
      };

    for (const fact of lineFacts) {
      const quantity = toNumber(fact.quantity);
      const defect = toNumber(fact.defectQuantity);

      addTo(workCenterRow.output, fact.factCategory, quantity);
      addTo(workCenterRow.defect, fact.factCategory, defect);
      addTo(totalsOutput, fact.factCategory, quantity);
      addTo(totalsDefect, fact.factCategory, defect);

      if (defect > 0) {
        const code = fact.defectReason?.code ?? null;
        const key = code ?? '—';
        const reasonRow =
          reasons.get(key) ??
          {
            code,
            name: fact.defectReason?.name ?? NO_REASON_LABEL,
            defect: emptyValue(),
            workCenterCodes: [],
          };
        addTo(reasonRow.defect, fact.factCategory, defect);
        if (!reasonRow.workCenterCodes.includes(workCenterKey)) {
          reasonRow.workCenterCodes.push(workCenterKey);
        }
        reasons.set(key, reasonRow);
      }
    }

    if (stopsCount > 0 || stopsMinutes > 0) {
      workCenterRow.stopsCount += stopsCount;
      workCenterRow.stopsMinutes += stopsMinutes;
      workCenterRow.linesWithStops += 1;
      linesWithStops.add(lineId);
      totalStopsCount += stopsCount;
      totalStopsMinutes += stopsMinutes;

      // Простой на человека — только оператору строки (решение владельца).
      const operatorKey = first.line.operator?.id ?? '—';
      const operatorRow =
        operatorStops.get(operatorKey) ??
        {
          employeeId: first.line.operator?.id ?? null,
          employeeName: first.line.operator?.fullName ?? NO_OPERATOR_LABEL,
          stopsMinutes: 0,
          stopsHours: 0,
        };
      operatorRow.stopsMinutes += stopsMinutes;
      operatorStops.set(operatorKey, operatorRow);
    }

    workCenters.set(workCenterKey, workCenterRow);
  }

  const workCenterRows = [...workCenters.values()]
    .map((row) => ({
      ...row,
      output: normalized(row.output),
      defect: normalized(row.defect),
      stopsHours: stopsHoursFromMinutes(row.stopsMinutes),
    }))
    .sort((a, b) => a.code.localeCompare(b.code, 'ru'));

  // Причины: сначала по убыванию брака (ГП), «без причины» — последней.
  const reasonRows = [...reasons.values()]
    .map((row) => ({ ...row, defect: normalized(row.defect) }))
    .sort((a, b) => {
      if (a.code === null) return 1;
      if (b.code === null) return -1;
      return b.defect.gp - a.defect.gp || a.name.localeCompare(b.name, 'ru');
    });

  const operatorRows = [...operatorStops.values()]
    // «Без персональной привязки» — последней строкой.
    .sort((a, b) => {
      if (a.employeeId === null) return 1;
      if (b.employeeId === null) return -1;
      return b.stopsMinutes - a.stopsMinutes || a.employeeName.localeCompare(b.employeeName, 'ru');
    })
    .map((row) => ({ ...row, stopsHours: stopsHoursFromMinutes(row.stopsMinutes) }));

  return {
    workCenters: workCenterRows,
    reasons: reasonRows,
    operatorStops: operatorRows,
    totals: {
      output: normalized(totalsOutput),
      defect: normalized(totalsDefect),
      stopsCount: totalStopsCount,
      stopsMinutes: totalStopsMinutes,
      stopsHours: stopsHoursFromMinutes(totalStopsMinutes),
      linesWithStops: linesWithStops.size,
    },
  };
}
