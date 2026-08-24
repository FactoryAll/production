import type { PrismaClient, ShiftSummary, ShiftSummaryConsumption } from '@prisma/client';
import { Prisma } from '@prisma/client';

export interface ShiftReportData {
  order: Awaited<ReturnType<typeof loadProductionOrder>>;
  summaries: Array<ShiftSummary & {
    consumption: Array<
      ShiftSummaryConsumption & {
        product: { id: string; name: string; unit: string };
      }
    >;
  }>;

  planVsFact: Array<{
    workCenterCode: string;
    workCenterName: string;
    planned: number;
    actual: number;
  }>;

  outputStructure: Array<{
    category: 'MASS' | 'PF' | 'GP';
    quantity: number;
  }>;

  defectsByReason: Array<{
    reasonName: string;
    quantity: number;
  }>;

  stopsByDuration: Array<{
    durationRange: string;
    count: number;
    totalMinutes: number;
  }>;

  consumptionByProduct: Array<{
    productName: string;
    quantity: number;
    unit: string;
  }>;
}

async function loadProductionOrder(orderId: string, prisma: PrismaClient) {
  return prisma.productionOrder.findUnique({
    where: { id: orderId },
    include: {
      shift: true,
      lines: {
        include: {
          workCenter: true,
          product: true,
          operator: true,
          facts: {
            include: {
              defectReason: true,
            },
          },
        },
      },
    },
  });
}

async function loadShiftSummaries(orderId: string, prisma: PrismaClient) {
  return prisma.shiftSummary.findMany({
    where: { productionOrderId: orderId },
    include: {
      workCenter: true,
      consumption: {
        include: {
          product: { select: { id: true, name: true, unit: true } },
        },
      },
    },
  }) as Promise<
    Array<
      ShiftSummary & {
        consumption: Array<
          ShiftSummaryConsumption & {
            product: { id: string; name: string; unit: string };
          }
        >;
      }
    >
  >;
}

function toNumber(value: Prisma.Decimal | number | string): number {
  if (value instanceof Prisma.Decimal) return value.toNumber();
  if (typeof value === 'number') return value;
  return new Prisma.Decimal(value).toNumber();
}

function sumDecimal(values: Array<Prisma.Decimal | number | string>): number {
  return values.reduce((sum: number, v) => sum + toNumber(v), 0);
}

const DURATION_RANGES = [
  { label: '0-15 мин', min: 0, max: 15 },
  { label: '15-30 мин', min: 15, max: 30 },
  { label: '30-60 мин', min: 30, max: 60 },
  { label: '60+ мин', min: 60, max: Infinity },
];

export async function getShiftReportData(
  orderId: string,
  prisma: PrismaClient,
): Promise<ShiftReportData> {
  const order = await loadProductionOrder(orderId, prisma);
  if (!order) {
    throw new Error('Производственное задание не найдено');
  }

  const summaries = await loadShiftSummaries(orderId, prisma);
  const summariesByWorkCenter = new Map(summaries.map((s) => [s.workCenterId, s]));

  const planVsFact = order.lines.map((line) => {
    const summary = summariesByWorkCenter.get(line.workCenterId);
    const actual = summary
      ? toNumber(summary.massOutput) +
        toNumber(summary.pfOutput) +
        toNumber(summary.gpOutput)
      : 0;
    return {
      workCenterCode: line.workCenter.code,
      workCenterName: line.workCenter.name,
      planned: toNumber(line.plannedQuantity),
      actual,
    };
  });

  const outputStructure: ShiftReportData['outputStructure'] = [
    {
      category: 'MASS' as const,
      quantity: sumDecimal(summaries.map((s) => s.massOutput)),
    },
    {
      category: 'PF' as const,
      quantity: sumDecimal(summaries.map((s) => s.pfOutput)),
    },
    {
      category: 'GP' as const,
      quantity: sumDecimal(summaries.map((s) => s.gpOutput)),
    },
  ].filter((item) => item.quantity > 0);

  const defectMap = new Map<string, number>();
  for (const line of order.lines) {
    for (const fact of line.facts) {
      if (toNumber(fact.defectQuantity) > 0 && fact.defectReason) {
        const reasonName = fact.defectReason.name;
        defectMap.set(
          reasonName,
          (defectMap.get(reasonName) || 0) + toNumber(fact.defectQuantity),
        );
      }
    }
  }
  const defectsByReason = Array.from(defectMap.entries())
    .map(([reasonName, quantity]) => ({ reasonName, quantity }))
    .sort((a, b) => b.quantity - a.quantity);

  const stopsByDuration = DURATION_RANGES.map((range) => {
    let count = 0;
    let totalMinutes = 0;
    for (const line of order.lines) {
      for (const fact of line.facts) {
        const duration = fact.stopsDurationMinutes;
        if (duration > 0 && duration >= range.min && duration < range.max) {
          count += 1;
          totalMinutes += duration;
        }
      }
    }
    return {
      durationRange: range.label,
      count,
      totalMinutes,
    };
  }).filter((item) => item.count > 0);

  const consumptionMap = new Map<
    string,
    { productName: string; quantity: number; unit: string }
  >();
  for (const summary of summaries) {
    for (const c of summary.consumption) {
      const existing = consumptionMap.get(c.productId);
      if (existing) {
        existing.quantity += toNumber(c.quantity);
      } else {
        consumptionMap.set(c.productId, {
          productName: c.product.name,
          quantity: toNumber(c.quantity),
          unit: c.unit,
        });
      }
    }
  }
  const consumptionByProduct = Array.from(consumptionMap.values()).sort(
    (a, b) => b.quantity - a.quantity,
  );

  return {
    order,
    summaries,
    planVsFact,
    outputStructure,
    defectsByReason,
    stopsByDuration,
    consumptionByProduct,
  };
}
