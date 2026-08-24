import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  applyStockMovements,
  getAvailableBalance,
  getStockBalance,
  buildProductionFactMovements,
} from '../stock-service';

const Decimal = Prisma.Decimal;

function buildMockTx() {
  const movements: Record<string, unknown>[] = [];
  const balances = new Map<
    string,
    { id: string; warehouseId: string; productId: string; stockCategory: 'MASS' | 'PF' | 'GP'; quantity: Prisma.Decimal }
  >();

  const createMany = vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown>[] }) => {
    movements.push(...data);
    return { count: data.length };
  });

  const findUnique = vi.fn().mockImplementation(async ({ where }: { where: { warehouseId_productId_stockCategory: { warehouseId: string; productId: string; stockCategory: 'MASS' | 'PF' | 'GP' } } }) => {
    return balances.get(`${where.warehouseId_productId_stockCategory.warehouseId}:${where.warehouseId_productId_stockCategory.productId}:${where.warehouseId_productId_stockCategory.stockCategory}`) ?? null;
  });

  const upsert = vi.fn().mockImplementation(async ({ where, update, create }: { where: { warehouseId_productId_stockCategory: { warehouseId: string; productId: string; stockCategory: 'MASS' | 'PF' | 'GP' } }; update: { quantity: Prisma.Decimal }; create: { warehouseId: string; productId: string; stockCategory: 'MASS' | 'PF' | 'GP'; quantity: Prisma.Decimal } }) => {
    const key = `${where.warehouseId_productId_stockCategory.warehouseId}:${where.warehouseId_productId_stockCategory.productId}:${where.warehouseId_productId_stockCategory.stockCategory}`;
    const existing = balances.get(key);
    const record = {
      id: existing?.id ?? 'balance-new',
      ...existing,
      warehouseId: where.warehouseId_productId_stockCategory.warehouseId,
      productId: where.warehouseId_productId_stockCategory.productId,
      stockCategory: where.warehouseId_productId_stockCategory.stockCategory,
      quantity: existing ? update.quantity : create.quantity,
    };
    balances.set(key, record);
    return record;
  });

  const tx = {
    stockMovement: { createMany },
    stockBalance: { findUnique, upsert },
  } as unknown as Parameters<typeof applyStockMovements>[0];

  return { tx, getMovements: () => movements, getBalances: () => balances };
}

describe('applyStockMovements', () => {
  it('RECEIPT increases the balance', async () => {
    const { tx, getBalances } = buildMockTx();
    await applyStockMovements(tx, [
      { warehouseId: 'wh-1', productId: 'p-1', stockCategory: 'MASS', type: 'RECEIPT', quantity: new Decimal(100), sourceType: 'PRODUCTION_FACT', sourceId: 'fact-1' },
    ]);

    const balance = getBalances().get('wh-1:p-1:MASS');
    expect(balance?.quantity.toNumber()).toBe(100);
  });

  it('CONSUMPTION decreases the balance', async () => {
    const { tx, getBalances } = buildMockTx();
    await applyStockMovements(tx, [
      { warehouseId: 'wh-1', productId: 'p-1', stockCategory: 'MASS', type: 'RECEIPT', quantity: new Decimal(100), sourceType: 'PRODUCTION_FACT', sourceId: 'fact-1' },
      { warehouseId: 'wh-1', productId: 'p-1', stockCategory: 'MASS', type: 'CONSUMPTION', quantity: new Decimal(30), sourceType: 'PRODUCTION_FACT', sourceId: 'fact-1' },
    ]);

    expect(getBalances().get('wh-1:p-1:MASS')?.quantity.toNumber()).toBe(70);
  });

  it('ISSUE decreases the balance', async () => {
    const { tx, getBalances } = buildMockTx();
    await applyStockMovements(tx, [
      { warehouseId: 'wh-1', productId: 'p-1', stockCategory: 'PF', type: 'RECEIPT', quantity: new Decimal(50), sourceType: 'PRODUCTION_FACT', sourceId: 'fact-1' },
      { warehouseId: 'wh-1', productId: 'p-1', stockCategory: 'PF', type: 'ISSUE', quantity: new Decimal(10), sourceType: 'GOODS_TRANSFER', sourceId: 'tr-1' },
    ]);

    expect(getBalances().get('wh-1:p-1:PF')?.quantity.toNumber()).toBe(40);
  });

  it('RETURN increases the balance', async () => {
    const { tx, getBalances } = buildMockTx();
    await applyStockMovements(tx, [
      { warehouseId: 'wh-1', productId: 'p-1', stockCategory: 'MASS', type: 'RECEIPT', quantity: new Decimal(20), sourceType: 'PRODUCTION_FACT', sourceId: 'fact-1' },
      { warehouseId: 'wh-1', productId: 'p-1', stockCategory: 'MASS', type: 'RETURN', quantity: new Decimal(5), sourceType: 'TRANSFER_CANCEL', sourceId: 'tr-2' },
    ]);

    expect(getBalances().get('wh-1:p-1:MASS')?.quantity.toNumber()).toBe(25);
  });

  it('groups multiple movements for the same key', async () => {
    const { tx, getBalances } = buildMockTx();
    await applyStockMovements(tx, [
      { warehouseId: 'wh-1', productId: 'p-1', stockCategory: 'MASS', type: 'RECEIPT', quantity: new Decimal(10), sourceType: 'PRODUCTION_FACT', sourceId: 'fact-1' },
      { warehouseId: 'wh-1', productId: 'p-1', stockCategory: 'MASS', type: 'RECEIPT', quantity: new Decimal(20), sourceType: 'PRODUCTION_FACT', sourceId: 'fact-2' },
      { warehouseId: 'wh-1', productId: 'p-1', stockCategory: 'MASS', type: 'CONSUMPTION', quantity: new Decimal(5), sourceType: 'PRODUCTION_FACT', sourceId: 'fact-2' },
    ]);

    expect(getBalances().get('wh-1:p-1:MASS')?.quantity.toNumber()).toBe(25);
  });

  it('stores the movement records', async () => {
    const { tx, getMovements } = buildMockTx();
    await applyStockMovements(tx, [
      { warehouseId: 'wh-1', productId: 'p-1', stockCategory: 'MASS', type: 'RECEIPT', quantity: new Decimal(5), sourceType: 'BACKFILL', sourceId: 'fact-1' },
    ]);

    expect(getMovements()).toHaveLength(1);
    expect(getMovements()[0]).toMatchObject({ sourceType: 'BACKFILL', type: 'RECEIPT', quantity: expect.any(Decimal) });
  });

  it('corrects fact 100 → 80 via compensating CONSUMPTION', async () => {
    const { tx, getBalances } = buildMockTx();
    await applyStockMovements(tx, [
      { warehouseId: 'wh-1', productId: 'p-1', stockCategory: 'MASS', type: 'RECEIPT', quantity: new Decimal(100), sourceType: 'PRODUCTION_FACT', sourceId: 'fact-1' },
      { warehouseId: 'wh-1', productId: 'p-1', stockCategory: 'MASS', type: 'CONSUMPTION', quantity: new Decimal(20), sourceType: 'FACT_CORRECTION', sourceId: 'fact-1' },
    ]);

    expect(getBalances().get('wh-1:p-1:MASS')?.quantity.toNumber()).toBe(80);
  });
});

describe('StockBalance invariant', () => {
  it('balance equals Σ movements after a series of operations', async () => {
    const { tx, getBalances, getMovements } = buildMockTx();

    await applyStockMovements(tx, [
      { warehouseId: 'wh-1', productId: 'p-1', stockCategory: 'MASS', type: 'RECEIPT', quantity: new Decimal(200), sourceType: 'PRODUCTION_FACT', sourceId: 'fact-1' },
      { warehouseId: 'wh-1', productId: 'p-2', stockCategory: 'PF', type: 'RECEIPT', quantity: new Decimal(80), sourceType: 'PRODUCTION_FACT', sourceId: 'fact-2' },
      { warehouseId: 'wh-1', productId: 'p-1', stockCategory: 'MASS', type: 'CONSUMPTION', quantity: new Decimal(40), sourceType: 'PRODUCTION_FACT', sourceId: 'fact-2' },
      { warehouseId: 'wh-1', productId: 'p-2', stockCategory: 'PF', type: 'CONSUMPTION', quantity: new Decimal(25), sourceType: 'FACT_CORRECTION', sourceId: 'fact-2' },
    ]);

    const balanceP1 = getBalances().get('wh-1:p-1:MASS')?.quantity.toNumber() ?? 0;
    const balanceP2 = getBalances().get('wh-1:p-2:PF')?.quantity.toNumber() ?? 0;

    const sumP1 = getMovements()
      .filter((m) => m.productId === 'p-1' && m.stockCategory === 'MASS')
      .reduce((sum, m) => sum + (m.type === 'RECEIPT' || m.type === 'RETURN' ? (m.quantity as Prisma.Decimal).toNumber() : -(m.quantity as Prisma.Decimal).toNumber()), 0);
    const sumP2 = getMovements()
      .filter((m) => m.productId === 'p-2' && m.stockCategory === 'PF')
      .reduce((sum, m) => sum + (m.type === 'RECEIPT' || m.type === 'RETURN' ? (m.quantity as Prisma.Decimal).toNumber() : -(m.quantity as Prisma.Decimal).toNumber()), 0);

    expect(balanceP1).toBe(sumP1);
    expect(balanceP2).toBe(sumP2);
  });
});

describe('getAvailableBalance', () => {
  it('returns MASS balance for MASS product', async () => {
    const client = {
      product: { findUnique: vi.fn().mockResolvedValue({ unit: 'кг', category: 'MASS' }) },
      warehouse: { findFirst: vi.fn().mockResolvedValue({ id: 'wh-prod' }) },
      stockBalance: { findUnique: vi.fn().mockResolvedValue({ quantity: new Decimal(120) }) },
    } as never;

    const result = await getAvailableBalance(client, 'mass-1');
    expect(result.available).toBe(120);
    expect(result.unit).toBe('кг');
    expect(result.stockCategory).toBe('MASS');
  });

  it('returns PF balance for GP product', async () => {
    const client = {
      product: { findUnique: vi.fn().mockResolvedValue({ unit: 'шт', category: 'GP' }) },
      warehouse: { findFirst: vi.fn().mockResolvedValue({ id: 'wh-prod' }) },
      stockBalance: { findUnique: vi.fn().mockResolvedValue({ quantity: new Decimal(40) }) },
    } as never;

    const result = await getAvailableBalance(client, 'gp-1');
    expect(result.available).toBe(40);
    expect(result.unit).toBe('шт');
    expect(result.stockCategory).toBe('PF');
  });
});

describe('getStockBalance', () => {
  it('filters by warehouse type', async () => {
    const client = {
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'b1', warehouse: { type: 'PRODUCTION' }, product: { code: 'P-1', name: 'Prod', unit: 'кг', category: 'MASS' } },
        ]),
      },
    } as unknown as Parameters<typeof getStockBalance>[0];

    const result = await getStockBalance(client, { warehouseType: 'PRODUCTION' });
    expect(result).toHaveLength(1);
    expect(client.stockBalance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { warehouse: { type: 'PRODUCTION' } } }),
    );
  });
});

describe('buildProductionFactMovements', () => {
  it('maps MASS fact to MASS receipt', () => {
    const movements = buildProductionFactMovements({
      factId: 'fact-1',
      productId: 'mass-1',
      factCategory: 'MASS',
      quantity: 100,
      warehouseId: 'wh-prod',
      sourceType: 'PRODUCTION_FACT',
    });

    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ type: 'RECEIPT', stockCategory: 'MASS', quantity: 100 });
  });

  it('maps GP fact to GP receipt', () => {
    const movements = buildProductionFactMovements({
      factId: 'fact-2',
      productId: 'gp-1',
      factCategory: 'GP',
      quantity: 50,
      warehouseId: 'wh-prod',
      sourceType: 'PRODUCTION_FACT',
    });

    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ type: 'RECEIPT', stockCategory: 'GP', quantity: 50 });
  });

  it('maps PF fact to PF receipt', () => {
    const movements = buildProductionFactMovements({
      factId: 'fact-3',
      productId: 'pf-1',
      factCategory: 'PF',
      quantity: 20,
      warehouseId: 'wh-prod',
      sourceType: 'PRODUCTION_FACT',
    });

    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ type: 'RECEIPT', stockCategory: 'PF', quantity: 20 });
  });

  it('maps MASS consumption product to MASS consumption', () => {
    const movements = buildProductionFactMovements({
      factId: 'fact-2',
      productId: 'gp-1',
      factCategory: 'GP',
      quantity: 50,
      warehouseId: 'wh-prod',
      sourceType: 'PRODUCTION_FACT',
      consumption: [{ productId: 'mass-1', productCategory: 'MASS', quantity: 10 }],
    });

    expect(movements).toHaveLength(2);
    expect(movements[1]).toMatchObject({ type: 'CONSUMPTION', stockCategory: 'MASS', quantity: 10 });
  });

  it('maps GP consumption product to PF consumption', () => {
    const movements = buildProductionFactMovements({
      factId: 'fact-2',
      productId: 'gp-1',
      factCategory: 'GP',
      quantity: 50,
      warehouseId: 'wh-prod',
      sourceType: 'PRODUCTION_FACT',
      consumption: [{ productId: 'gp-2', productCategory: 'GP', quantity: 8 }],
    });

    expect(movements).toHaveLength(2);
    expect(movements[1]).toMatchObject({ type: 'CONSUMPTION', stockCategory: 'PF', quantity: 8 });
  });
});
