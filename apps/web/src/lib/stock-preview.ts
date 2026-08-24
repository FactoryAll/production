import { Prisma } from '@prisma/client';
import { prisma, type TxClient } from '@prodtrack/db';

export interface AvailableBalance {
  available: number;
  unit: string;
}

export async function getAvailableBalance(productId: string, client: TxClient = prisma): Promise<AvailableBalance> {
  const product = await client.product.findUnique({
    where: { id: productId },
    select: { unit: true, category: true },
  });

  if (!product) {
    throw new Error('Продукт не найден');
  }

  let produced: Prisma.Decimal = new Prisma.Decimal(0);
  if (product.category === 'MASS') {
    const facts = await client.productionFact.findMany({
      where: { factCategory: 'MASS', productId },
      select: { quantity: true },
    });
    produced = facts.reduce((sum: Prisma.Decimal, f: { quantity: Prisma.Decimal }) => sum.plus(f.quantity), produced);
  } else {
    const facts = await client.productionFact.findMany({
      where: { factCategory: 'PF', productId },
      select: { quantity: true },
    });
    produced = facts.reduce((sum: Prisma.Decimal, f: { quantity: Prisma.Decimal }) => sum.plus(f.quantity), produced);
  }

  const consumed = await client.factConsumption.findMany({
    where: { productId },
    select: { quantity: true },
  });
  const consumedTotal = consumed.reduce(
    (sum: Prisma.Decimal, c: { quantity: Prisma.Decimal }) => sum.plus(c.quantity),
    new Prisma.Decimal(0),
  );

  return {
    available: produced.minus(consumedTotal).toNumber(),
    unit: product.unit,
  };
}

// TODO T-035: заменить на баланс-сервис поверх StockMovement
