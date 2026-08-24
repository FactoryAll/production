import { Prisma, type PrismaClient } from '@prisma/client';
import { writeAudit, writeTiming, type TxClient } from '@prodtrack/db';

export interface ShiftSummaryAggregates {
  massOutput: Prisma.Decimal;
  pfOutput: Prisma.Decimal;
  gpOutput: Prisma.Decimal;
  defectQuantity: Prisma.Decimal;
  stopsCount: number;
  stopsDurationMinutes: number;
  plannedQuantity: Prisma.Decimal;
  plannedProductIds: string[];
}

export interface ConsumptionAggregate {
  productId: string;
  quantity: Prisma.Decimal;
  unit: string;
}

function zero(): Prisma.Decimal {
  return new Prisma.Decimal(0);
}

function toDecimal(value: Prisma.Decimal | number | string): Prisma.Decimal {
  if (value instanceof Prisma.Decimal) return value;
  return new Prisma.Decimal(value);
}

function sumDecimal(values: Prisma.Decimal[]): Prisma.Decimal {
  return values.reduce((sum, v) => sum.plus(v), zero());
}

function sumNumber(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0);
}

function aggregatesFromFacts(
  facts: Array<{
    factCategory: 'MASS' | 'PF' | 'GP';
    quantity: Prisma.Decimal;
    defectQuantity: Prisma.Decimal;
    stopsCount: number;
    stopsDurationMinutes: number;
  }>,
): Pick<
  ShiftSummaryAggregates,
  'massOutput' | 'pfOutput' | 'gpOutput' | 'defectQuantity' | 'stopsCount' | 'stopsDurationMinutes'
> {
  return {
    massOutput: sumDecimal(facts.filter((f) => f.factCategory === 'MASS').map((f) => f.quantity)),
    pfOutput: sumDecimal(facts.filter((f) => f.factCategory === 'PF').map((f) => f.quantity)),
    gpOutput: sumDecimal(facts.filter((f) => f.factCategory === 'GP').map((f) => f.quantity)),
    defectQuantity: sumDecimal(facts.map((f) => f.defectQuantity)),
    stopsCount: sumNumber(facts.map((f) => f.stopsCount)),
    stopsDurationMinutes: sumNumber(facts.map((f) => f.stopsDurationMinutes)),
  };
}

function aggregateConsumption(
  allConsumptions: Array<{
    productId: string;
    quantity: Prisma.Decimal | number | string;
    product: { unit: string };
  }>,
): ConsumptionAggregate[] {
  const map = new Map<string, ConsumptionAggregate>();
  for (const c of allConsumptions) {
    const q = toDecimal(c.quantity);
    const existing = map.get(c.productId);
    if (existing) {
      existing.quantity = existing.quantity.plus(q);
    } else {
      map.set(c.productId, {
        productId: c.productId,
        quantity: q,
        unit: c.product.unit,
      });
    }
  }
  return Array.from(map.values());
}

async function upsertShiftSummary(
  tx: TxClient,
  key: {
    productionOrderId: string;
    shiftId: string;
    workCenterId: string;
  },
  line: {
    plannedQuantity: Prisma.Decimal;
    productId: string;
  },
  facts: Parameters<typeof aggregatesFromFacts>[0],
  consumptions: Parameters<typeof aggregateConsumption>[0],
  completed: boolean,
  completedAt: Date | null,
  existingSummary: { id: string; completed: boolean } | null,
): Promise<void> {
  const aggregates = aggregatesFromFacts(facts);
  const plannedQuantity = line.plannedQuantity ?? zero();
  const plannedProductIds = [line.productId];
  const consumptionAggregates = aggregateConsumption(consumptions);

  const summaryData = {
    ...aggregates,
    plannedQuantity,
    plannedProductIds,
    completed,
    completedAt,
  };

  const summary = await tx.shiftSummary.upsert({
    where: {
      productionOrderId_workCenterId: {
        productionOrderId: key.productionOrderId,
        workCenterId: key.workCenterId,
      },
    },
    update: summaryData,
    create: {
      ...key,
      ...summaryData,
    },
  });

  await tx.shiftSummaryConsumption.deleteMany({
    where: { shiftSummaryId: summary.id },
  });

  if (consumptionAggregates.length > 0) {
    await tx.shiftSummaryConsumption.createMany({
      data: consumptionAggregates.map((c) => ({
        shiftSummaryId: summary.id,
        productId: c.productId,
        quantity: c.quantity,
        unit: c.unit,
      })),
    });
  }

  const oldValue = existingSummary
    ? JSON.stringify({ completed: existingSummary.completed })
    : undefined;
  const newValue = JSON.stringify({
    ...aggregates,
    plannedQuantity: plannedQuantity.toString(),
    plannedProductIds,
    completed,
    consumption: consumptionAggregates.map((c) => ({
      productId: c.productId,
      quantity: c.quantity.toString(),
      unit: c.unit,
    })),
  });

  await writeAudit(tx, {
    action: existingSummary ? 'UPDATE' : 'CREATE',
    objectType: 'ShiftSummary',
    objectId: summary.id,
    field: 'aggregates',
    oldValue,
    newValue,
  });
}

/**
 * Rebuilds all ShiftSummary records for a production order.
 * Called when the production order is closed (T-027).
 * TODO T-038: use ShiftSummary data for shift report diagrams and metrics.
 */
export async function buildShiftSummary(
  orderId: string,
  client: PrismaClient | TxClient,
): Promise<void> {
  const order = await client.productionOrder.findUnique({
    where: { id: orderId },
    include: {
      shift: true,
      lines: {
        where: { status: 'REPORTED' },
        include: {
          workCenter: true,
          product: { select: { id: true, unit: true } },
          facts: {
            include: {
              consumptions: {
                include: {
                  product: { select: { id: true, unit: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!order) {
    throw new Error('ПЗ не найдено');
  }

  const existingSummaries = await client.shiftSummary.findMany({
    where: { productionOrderId: orderId },
    select: { id: true, workCenterId: true, completed: true },
  });
  const existingByWorkCenter = new Map(existingSummaries.map((s) => [s.workCenterId, s]));

  const work = async (tx: TxClient) => {
    for (const line of order.lines) {
      const facts = line.facts.map((f) => ({
        factCategory: f.factCategory,
        quantity: f.quantity,
        defectQuantity: f.defectQuantity,
        stopsCount: f.stopsCount,
        stopsDurationMinutes: f.stopsDurationMinutes,
      }));

      const consumptions = line.facts.flatMap((f) =>
        f.consumptions.map((c) => ({
          productId: c.productId,
          quantity: c.quantity,
          product: c.product,
        })),
      );

      await upsertShiftSummary(
        tx,
        {
          productionOrderId: orderId,
          shiftId: order.shiftId,
          workCenterId: line.workCenterId,
        },
        { plannedQuantity: line.plannedQuantity, productId: line.productId },
        facts,
        consumptions,
        true,
        new Date(),
        existingByWorkCenter.get(line.workCenterId) ?? null,
      );
    }

    await writeTiming(tx, {
      documentType: 'PRODUCTION_ORDER',
      documentId: orderId,
      entityType: 'DOCUMENT',
      entityId: orderId,
      fromStatus: 'IN_PROGRESS',
      toStatus: 'COMPLETED',
    });
  };

  if ('$transaction' in client) {
    await (client as PrismaClient).$transaction(work);
  } else {
    await work(client);
  }
}

/**
 * Updates a single ShiftSummary for a production order line.
 * Called after reportProductionFact, correctFactByOperator or correctProductionFact.
 */
export async function updateShiftSummary(
  lineId: string,
  client: PrismaClient | TxClient,
): Promise<void> {
  const line = await client.productionOrderLine.findUnique({
    where: { id: lineId },
    include: {
      order: { include: { shift: true } },
      workCenter: true,
      product: { select: { id: true, unit: true } },
      facts: {
        include: {
          consumptions: {
            include: {
              product: { select: { id: true, unit: true } },
            },
          },
        },
      },
    },
  });

  if (!line) {
    throw new Error('Строка ПЗ не найдена');
  }

  const facts = line.facts.map((f) => ({
    factCategory: f.factCategory,
    quantity: f.quantity,
    defectQuantity: f.defectQuantity,
    stopsCount: f.stopsCount,
    stopsDurationMinutes: f.stopsDurationMinutes,
  }));

  const consumptions = line.facts.flatMap((f) =>
    f.consumptions.map((c) => ({
      productId: c.productId,
      quantity: c.quantity,
      product: c.product,
    })),
  );

  const existingSummary = await client.shiftSummary.findUnique({
    where: {
      productionOrderId_workCenterId: {
        productionOrderId: line.orderId,
        workCenterId: line.workCenterId,
      },
    },
    select: { id: true, completed: true, completedAt: true },
  });

  const orderCompleted = line.order.status === 'COMPLETED';
  const completed = existingSummary ? existingSummary.completed || orderCompleted : orderCompleted;
  const completedAt = completed ? existingSummary?.completedAt ?? new Date() : null;

  await upsertShiftSummary(
    client,
    {
      productionOrderId: line.orderId,
      shiftId: line.order.shiftId,
      workCenterId: line.workCenterId,
    },
    { plannedQuantity: line.plannedQuantity, productId: line.productId },
    facts,
    consumptions,
    completed,
    completedAt,
    existingSummary,
  );
}
