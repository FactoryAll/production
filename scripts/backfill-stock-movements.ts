import { PrismaClient, Prisma } from '@prisma/client';
import type { StockMovementType, StockCategory, ProductCategory, FactCategory } from '@prisma/client';

const prisma = new PrismaClient();

function toDecimal(value: Prisma.Decimal | number | string): Prisma.Decimal {
  if (value instanceof Prisma.Decimal) return value;
  return new Prisma.Decimal(value);
}

function factCategoryToStockCategory(factCategory: FactCategory): StockCategory {
  return factCategory as StockCategory;
}

function consumptionProductCategoryToStockCategory(productCategory: ProductCategory): StockCategory {
  if (productCategory === 'MASS') return 'MASS';
  return 'PF';
}

function movementSign(type: StockMovementType): number {
  return type === 'RECEIPT' || type === 'RETURN' ? 1 : -1;
}

interface MovementInput {
  warehouseId: string;
  productId: string;
  stockCategory: StockCategory;
  type: StockMovementType;
  quantity: Prisma.Decimal | number | string;
  sourceType: string;
  sourceId: string;
}

async function applyMovements(tx: Prisma.TransactionClient, movements: MovementInput[]) {
  if (movements.length === 0) return;

  await tx.stockMovement.createMany({
    data: movements.map((m) => ({
      warehouseId: m.warehouseId,
      productId: m.productId,
      stockCategory: m.stockCategory,
      type: m.type,
      quantity: toDecimal(m.quantity),
      sourceType: m.sourceType,
      sourceId: m.sourceId,
      createdAt: new Date(),
    })),
  });

  const deltas = new Map<
    string,
    { warehouseId: string; productId: string; stockCategory: StockCategory; delta: Prisma.Decimal }
  >();

  for (const m of movements) {
    const key = `${m.warehouseId}:${m.productId}:${m.stockCategory}`;
    const entry = deltas.get(key) ?? {
      warehouseId: m.warehouseId,
      productId: m.productId,
      stockCategory: m.stockCategory,
      delta: new Prisma.Decimal(0),
    };
    entry.delta = entry.delta.plus(toDecimal(m.quantity).times(movementSign(m.type)));
    deltas.set(key, entry);
  }

  for (const { warehouseId, productId, stockCategory, delta } of deltas.values()) {
    if (delta.equals(0)) continue;
    const existing = await tx.stockBalance.findUnique({
      where: { warehouseId_productId_stockCategory: { warehouseId, productId, stockCategory } },
    });
    const newQuantity = existing ? existing.quantity.plus(delta) : delta;
    await tx.stockBalance.upsert({
      where: { warehouseId_productId_stockCategory: { warehouseId, productId, stockCategory } },
      update: { quantity: newQuantity, updatedAt: new Date() },
      create: {
        warehouseId,
        productId,
        stockCategory,
        quantity: newQuantity,
        updatedAt: new Date(),
      },
    });
  }
}

async function main() {
  const productionWarehouse = await prisma.warehouse.findFirst({ where: { type: 'PRODUCTION' } });
  if (!productionWarehouse) {
    throw new Error('Производственный склад не найден');
  }

  const facts = await prisma.productionFact.findMany({
    include: {
      line: { include: { product: true } },
      consumptions: { include: { product: true } },
    },
  });

  let factsProcessed = 0;
  let movementsCreated = 0;

  for (const fact of facts) {
    const existingMovement = await prisma.stockMovement.findFirst({
      where: { sourceType: 'PRODUCTION_FACT', sourceId: fact.id },
    });
    if (existingMovement) continue;

    const movements: MovementInput[] = [
      {
        warehouseId: productionWarehouse.id,
        productId: fact.productId,
        stockCategory: factCategoryToStockCategory(fact.factCategory),
        type: 'RECEIPT',
        quantity: fact.quantity,
        sourceType: 'BACKFILL',
        sourceId: fact.id,
      },
    ];

    for (const c of fact.consumptions) {
      movements.push({
        warehouseId: productionWarehouse.id,
        productId: c.productId,
        stockCategory: consumptionProductCategoryToStockCategory(c.product.category),
        type: 'CONSUMPTION',
        quantity: c.quantity,
        sourceType: 'BACKFILL',
        sourceId: fact.id,
      });
    }

    await prisma.$transaction(async (tx) => {
      await applyMovements(tx, movements);
    });

    factsProcessed += 1;
    movementsCreated += movements.length;
  }

  console.log(`Backfill завершён: обработано фактов ${factsProcessed}, создано движений ${movementsCreated}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
