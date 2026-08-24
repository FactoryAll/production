import { Prisma } from '@prisma/client';
import type {
  StockMovementType,
  StockCategory,
  FactCategory,
  ProductCategory,
  WarehouseType,
  PrismaClient,
} from '@prisma/client';
import { type TxClient } from '@prodtrack/db';

export interface NewMovement {
  warehouseId: string;
  productId: string;
  stockCategory: StockCategory;
  type: StockMovementType;
  quantity: Prisma.Decimal | number | string;
  sourceType: string;
  sourceId: string;
}

export interface StockBalanceRow {
  id: string;
  warehouseId: string;
  productId: string;
  stockCategory: StockCategory;
  quantity: Prisma.Decimal;
  updatedAt: Date;
  product: {
    code: string;
    name: string;
    unit: string;
    category: ProductCategory;
  };
  warehouse: {
    type: WarehouseType;
  };
}

export interface AvailableBalance {
  available: number;
  unit: string;
  stockCategory: StockCategory;
}

function toDecimal(value: Prisma.Decimal | number | string): Prisma.Decimal {
  if (value instanceof Prisma.Decimal) return value;
  return new Prisma.Decimal(value);
}

export function factCategoryToStockCategory(factCategory: FactCategory): StockCategory {
  return factCategory as StockCategory;
}

export function consumptionProductCategoryToStockCategory(
  productCategory: ProductCategory,
): StockCategory {
  if (productCategory === 'MASS') return 'MASS';
  return 'PF';
}

function movementSign(type: StockMovementType): number {
  // TODO T-036: connect ISSUE/RETURN triggers when goods transfers are sent/cancelled (T-039/T-040)
  return type === 'RECEIPT' || type === 'RETURN' ? 1 : -1;
}

/**
 * Creates StockMovement records and updates StockBalance for each affected key.
 * RECEIPT / RETURN increase the balance, ISSUE / CONSUMPTION decrease it.
 */
export async function applyStockMovements(
  tx: TxClient,
  movements: NewMovement[],
): Promise<void> {
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
      where: {
        warehouseId_productId_stockCategory: {
          warehouseId,
          productId,
          stockCategory,
        },
      },
    });

    const newQuantity = existing ? existing.quantity.plus(delta) : delta;

    await tx.stockBalance.upsert({
      where: {
        warehouseId_productId_stockCategory: {
          warehouseId,
          productId,
          stockCategory,
        },
      },
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

export interface GetStockBalanceArgs {
  warehouseType?: WarehouseType;
  productId?: string;
  stockCategory?: StockCategory;
}

export async function getStockBalance(
  client: PrismaClient | TxClient,
  args: GetStockBalanceArgs,
): Promise<StockBalanceRow[]> {
  const where: Prisma.StockBalanceWhereInput = {};
  if (args.productId) {
    where.productId = args.productId;
  }
  if (args.stockCategory) {
    where.stockCategory = args.stockCategory;
  }
  if (args.warehouseType) {
    where.warehouse = { type: args.warehouseType };
  }

  return client.stockBalance.findMany({
    where,
    include: {
      product: {
        select: { code: true, name: true, unit: true, category: true },
      },
      warehouse: {
        select: { type: true },
      },
    },
    orderBy: [{ warehouseId: 'asc' }, { product: { code: 'asc' } }],
  }) as Promise<StockBalanceRow[]>;
}

/**
 * Returns the available balance on the production warehouse for a given product.
 * MASS product -> MASS category; GP product -> PF category.
 */
export async function getAvailableBalance(
  client: PrismaClient | TxClient,
  productId: string,
): Promise<AvailableBalance> {
  const product = await client.product.findUnique({
    where: { id: productId },
    select: { unit: true, category: true },
  });

  if (!product) {
    throw new Error('Продукт не найден');
  }

  const stockCategory =
    product.category === 'MASS' ? 'MASS' : ('PF' as StockCategory);

  const warehouse = await client.warehouse.findFirst({
    where: { type: 'PRODUCTION' },
    select: { id: true },
  });

  if (!warehouse) {
    throw new Error('Производственный склад не найден');
  }

  const balance = await client.stockBalance.findUnique({
    where: {
      warehouseId_productId_stockCategory: {
        warehouseId: warehouse.id,
        productId,
        stockCategory,
      },
    },
  });

  return {
    available: balance ? balance.quantity.toNumber() : 0,
    unit: product.unit,
    stockCategory,
  };
}

/**
 * Helper to build production-fact movements (receipt + consumption).
 */
export function buildProductionFactMovements(
  input: {
    factId: string;
    productId: string;
    factCategory: FactCategory;
    quantity: Prisma.Decimal | number | string;
    warehouseId: string;
    sourceType: string;
    consumption?: Array<{ productId: string; productCategory: ProductCategory; quantity: Prisma.Decimal | number | string }>;
  },
): NewMovement[] {
  const movements: NewMovement[] = [
    {
      warehouseId: input.warehouseId,
      productId: input.productId,
      stockCategory: factCategoryToStockCategory(input.factCategory),
      type: 'RECEIPT',
      quantity: input.quantity,
      sourceType: input.sourceType,
      sourceId: input.factId,
    },
  ];

  for (const item of input.consumption ?? []) {
    movements.push({
      warehouseId: input.warehouseId,
      productId: item.productId,
      stockCategory: consumptionProductCategoryToStockCategory(item.productCategory),
      type: 'CONSUMPTION',
      quantity: item.quantity,
      sourceType: input.sourceType,
      sourceId: input.factId,
    });
  }

  return movements;
}
