import type { PrismaClient } from '@prisma/client';
import type { ReportPeriod } from './period';

/**
 * Отчёт «Движение склада» (T-096, решение владельца 26.10.2026).
 *
 * За период по каждому складу, номенклатуре и категории остатка:
 *   остаток на начало — сумма движений ДО начала периода;
 *   приход — сумма приходных движений за период;
 *   расход — сумма расходных движений за период;
 *   остаток на конец — начало + приход − расход.
 *
 * Остаток на начало считается по движениям, а не по текущей таблице остатков:
 * иначе отчёт за прошлый месяц показывал бы сегодняшние числа.
 */
export interface StockReportRow {
  warehouseName: string;
  productCode: string;
  productName: string;
  unit: string;
  category: string;
  opening: number;
  receipt: number;
  issue: number;
  closing: number;
}

export interface StockReport {
  rows: StockReportRow[];
  totals: { opening: number; receipt: number; issue: number; closing: number };
}

const RECEIPT_TYPES = new Set(['RECEIPT', 'RETURN']);
const ISSUE_TYPES = new Set(['ISSUE', 'CONSUMPTION']);

function toNumber(value: { toString(): string } | number): number {
  return typeof value === 'number' ? value : Number(value.toString());
}

export async function getStockReport(
  client: PrismaClient,
  period: ReportPeriod,
): Promise<StockReport> {
  const [opening, within] = await Promise.all([
    client.stockMovement.groupBy({
      by: ['warehouseId', 'productId', 'stockCategory'],
      where: { createdAt: { lt: period.from } },
      _sum: { quantity: true },
    }),
    client.stockMovement.findMany({
      where: { createdAt: { gte: period.from, lte: period.to } },
      select: {
        warehouseId: true,
        productId: true,
        stockCategory: true,
        type: true,
        quantity: true,
      },
    }),
  ]);

  const keyOf = (warehouseId: string, productId: string, category: string) =>
    `${warehouseId}|${productId}|${category}`;

  const balances = new Map<string, { warehouseId: string; productId: string; category: string; opening: number; receipt: number; issue: number }>();

  const ensure = (warehouseId: string, productId: string, category: string) => {
    const key = keyOf(warehouseId, productId, category);
    let entry = balances.get(key);
    if (!entry) {
      entry = { warehouseId, productId, category, opening: 0, receipt: 0, issue: 0 };
      balances.set(key, entry);
    }
    return entry;
  };

  for (const row of opening) {
    // Приходные движения положительные, расходные — уже со знаком минус в истории,
    // поэтому сумма до периода и есть остаток на начало.
    ensure(row.warehouseId, row.productId, row.stockCategory).opening += toNumber(row._sum.quantity ?? 0);
  }

  for (const movement of within) {
    const entry = ensure(movement.warehouseId, movement.productId, movement.stockCategory);
    const quantity = toNumber(movement.quantity);
    if (RECEIPT_TYPES.has(movement.type)) {
      entry.receipt += quantity;
    } else if (ISSUE_TYPES.has(movement.type)) {
      entry.issue += quantity;
    } else {
      // Неизвестный тип не теряем: считаем приходом, чтобы сумма сходилась.
      entry.receipt += quantity;
    }
  }

  const warehouseIds = [...new Set([...balances.values()].map((entry) => entry.warehouseId))];
  const productIds = [...new Set([...balances.values()].map((entry) => entry.productId))];

  const [warehouses, products] = await Promise.all([
    client.warehouse.findMany({ where: { id: { in: warehouseIds } }, select: { id: true, name: true } }),
    client.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, code: true, name: true, unit: true },
    }),
  ]);

  const warehouseName = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse.name]));
  const productById = new Map(products.map((product) => [product.id, product]));

  const rows: StockReportRow[] = [...balances.values()]
    .map((entry) => {
      const product = productById.get(entry.productId);
      return {
        warehouseName: warehouseName.get(entry.warehouseId) ?? '—',
        productCode: product?.code ?? '—',
        productName: product?.name ?? '—',
        unit: product?.unit ?? '',
        category: entry.category,
        opening: Math.round(entry.opening * 1000) / 1000,
        receipt: Math.round(entry.receipt * 1000) / 1000,
        issue: Math.round(entry.issue * 1000) / 1000,
        closing: Math.round((entry.opening + entry.receipt - entry.issue) * 1000) / 1000,
      };
    })
    .filter((row) => row.opening !== 0 || row.receipt !== 0 || row.issue !== 0)
    .sort(
      (a, b) =>
        a.warehouseName.localeCompare(b.warehouseName) ||
        a.productName.localeCompare(b.productName) ||
        a.category.localeCompare(b.category),
    );

  const total = (pick: (row: StockReportRow) => number) =>
    Math.round(rows.reduce((sum, row) => sum + pick(row), 0) * 1000) / 1000;

  return {
    rows,
    totals: {
      opening: total((row) => row.opening),
      receipt: total((row) => row.receipt),
      issue: total((row) => row.issue),
      closing: total((row) => row.closing),
    },
  };
}
