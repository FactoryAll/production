import type { PrismaClient } from '@prisma/client';
import type { ReportPeriod } from './period';
import { pickPrimaryFact } from '../fact-worker-composition';

/**
 * Отчёт «Потребление» (T-098, постановка `docs/report_consumption.md`).
 *
 * Что и почему именно так:
 *
 * 1. **Единица** — строка потребления (`FactConsumption`): номенклатура + **категория остатка**
 *    (`stockCategory`: Масса / ПФ / ГП) + количество. Категория хранится в строке, а не выводится
 *    из номенклатуры (ОПЭ-34): Масса и ПФ — разные остатки одной номенклатуры ГП.
 * 2. **РЦ** — это РЦ строки ПЗ, а не склад: потребление привязано к факту, факт — к строке.
 *    Именно этот разрез отличает отчёт от «Движения склада» (T-096), где есть только
 *    номенклатура и категория.
 * 3. **Дубли** — правило, уже принятое для простоев (T-101, ОПЭ-73), второе не заводим:
 *    группируем по (строка, номенклатура, категория остатка), значение берём с **основного
 *    факта** строки через `pickPrimaryFact`; если в основном факте его нет, а в другом есть
 *    (след старых данных, когда потребление писалось в каждый факт, — ОПЭ-38), берём максимум
 *    по дублям и считаем строку счётчиком `linesWithSecondaryConsumption`.
 * 4. **Показываем то, что лежит в данных** (урок ОПЭ-75): количество — факт из `FactConsumption`.
 *    Планового потребления в модели нет, поэтому подмены «план вместо факта» здесь быть
 *    не может — это закреплено тестом на выборку полей.
 */

export type ConsumptionView = 'workCenter' | 'product';

/** Категории остатка в порядке отображения: Масса → ПФ → ГП. */
export const STOCK_CATEGORIES = ['MASS', 'PF', 'GP'] as const;
export type StockCategoryKey = (typeof STOCK_CATEGORIES)[number];

export const STOCK_CATEGORY_LABELS: Record<string, string> = {
  MASS: 'Масса',
  PF: 'ПФ',
  GP: 'ГП'
};

/** Разрез по РЦ: строка = РЦ + номенклатура + категория остатка. */
export interface ConsumptionWorkCenterRow {
  workCenterCode: string;
  workCenterName: string;
  productCode: string;
  productName: string;
  productUnit: string;
  stockCategory: string;
  /** Израсходовано, в единицах номенклатуры. */
  quantity: number;
  /** Сколько строк ПЗ списывали эту номенклатуру. */
  lines: number;
}

/** Разрез по номенклатуре: строка = номенклатура + категория остатка, РЦ — перечнем. */
export interface ConsumptionProductRow {
  productCode: string;
  productName: string;
  productUnit: string;
  stockCategory: string;
  quantity: number;
  lines: number;
  /** Коды РЦ, где списывали эту номенклатуру (это и есть новое по сравнению с T-096). */
  workCenterCodes: string[];
}

export interface ConsumptionTotals {
  /** Итого по категориям остатка — разные номенклатуры не складываем. */
  byCategory: Record<string, number>;
  /** Всего строк потребления после дедупликации. */
  lines: number;
  /**
   * Строки, где потребление нашлось **не в основном** факте (след старых данных ОПЭ-38).
   * Показывается счётчиком, чтобы цифра объясняла происхождение, а не выглядела потерей.
   */
  linesWithSecondaryConsumption: number;
}

export interface ConsumptionReport {
  workCenters: ConsumptionWorkCenterRow[];
  products: ConsumptionProductRow[];
  totals: ConsumptionTotals;
}

interface ConsumptionFactRow {
  factCategory: string;
  consumptions: Array<{
    productId: string;
    quantity: { toString(): string };
    stockCategory: string;
    product: { code: string; name: string; unit: string };
  }>;
}

interface ConsumptionLineRow {
  id: string;
  productId: string;
  orderId: string;
  order: { status: string };
  workCenter: { code: string; name: string };
  product: { code: string; name: string; unit: string; category: string };
  facts: ConsumptionFactRow[];
}

function toNumber(value: { toString(): string }): number {
  return Number(value.toString());
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Ключ дедупликации: строка + номенклатура + категория остатка (ОПЭ-38, T-101). */
function consumptionKey(lineId: string, productId: string, stockCategory: string): string {
  return `${lineId}|${productId}|${stockCategory}`;
}

export async function getConsumptionReport(
  client: Pick<PrismaClient, 'productionOrderLine'>,
  period: ReportPeriod,
  filter: { workCenterId?: string; productId?: string } = {}
): Promise<ConsumptionReport> {
  const lines = (await client.productionOrderLine.findMany({
    where: {
      // Отменённые ПЗ не входят: строки не выполнялись. Незакрытые с фактом входят:
      // потребление уже произошло.
      order: {
        status: { not: 'CANCELLED' },
        shift: { date: { gte: period.from, lte: period.to } }
      },
      ...(filter.workCenterId ? { workCenterId: filter.workCenterId } : {}),
      ...(filter.productId ? { productId: filter.productId } : {})
    },
    select: {
      id: true,
      productId: true,
      orderId: true,
      workCenter: { select: { code: true, name: true } },
      product: { select: { code: true, name: true, unit: true, category: true } },
      order: { select: { status: true } },
      facts: {
        select: {
          factCategory: true,
          consumptions: {
            select: {
              productId: true,
              quantity: true,
              stockCategory: true,
              product: { select: { code: true, name: true, unit: true } }
            }
          }
        }
      }
    }
  })) as ConsumptionLineRow[];

  // Дедупликация: один ключ (строка + номенклатура + категория остатка) — одна запись.
  const deduped = new Map<
    string,
    {
      quantity: number;
      lineId: string;
      orderId: string;
      workCenter: { code: string; name: string };
      product: { code: string; name: string; unit: string };
      stockCategory: string;
      fromSecondary: boolean;
    }
  >();

  for (const line of lines) {
    // Основной факт строки — то же правило, что у состава и простоев.
    const primary = pickPrimaryFact(
      line.facts as Array<{ factCategory: string }>,
      line.product.category
    ) as ConsumptionFactRow | undefined;

    const grouped = new Map<
      string,
      {
        primary: number | null;
        otherMax: number;
        fromSecondary: boolean;
        product: { code: string; name: string; unit: string };
        stockCategory: string;
      }
    >();

    for (const fact of line.facts) {
      const isPrimary = fact === primary;
      for (const consumption of fact.consumptions) {
        const key = consumptionKey(line.id, consumption.productId, consumption.stockCategory);
        const entry = grouped.get(key) ?? {
          primary: null,
          otherMax: 0,
          fromSecondary: false,
          product: consumption.product,
          stockCategory: consumption.stockCategory
        };
        const quantity = toNumber(consumption.quantity);
        if (isPrimary) {
          entry.primary = quantity;
        } else {
          entry.otherMax = Math.max(entry.otherMax, quantity);
        }
        grouped.set(key, entry);
      }
    }

    for (const [key, entry] of grouped) {
      // Значение — с основного факта; если его там нет, а в другом есть, это след старых
      // данных: берём оттуда и помечаем строку счётчиком.
      const fromSecondary = entry.primary === null && entry.otherMax > 0;
      const quantity = entry.primary ?? entry.otherMax;

      const existing = deduped.get(key);
      if (existing) {
        // Один и тот же ключ дважды в одной строке — не суммируем, берём максимум
        // и отмечаем как дубль (в данных его быть не должно, но история бывает разной).
        existing.quantity = Math.max(existing.quantity, quantity);
        existing.fromSecondary = existing.fromSecondary || fromSecondary;
        continue;
      }

      deduped.set(key, {
        quantity,
        lineId: line.id,
        orderId: line.orderId,
        workCenter: line.workCenter,
        product: entry.product,
        stockCategory: entry.stockCategory,
        fromSecondary
      });
    }
  }

  const workCenterRows = new Map<string, ConsumptionWorkCenterRow>();
  const productRows = new Map<string, ConsumptionProductRow>();
  const byCategory: Record<string, number> = { MASS: 0, PF: 0, GP: 0 };
  const orderLines = new Set<string>();
  let linesWithSecondaryConsumption = 0;

  for (const entry of deduped.values()) {
    byCategory[entry.stockCategory] = (byCategory[entry.stockCategory] ?? 0) + entry.quantity;
    orderLines.add(entry.lineId);
    if (entry.fromSecondary) {
      linesWithSecondaryConsumption += 1;
    }

    const workCenterKey = `${entry.workCenter.code}|${entry.product.code}|${entry.stockCategory}`;
    const workCenterRow = workCenterRows.get(workCenterKey) ?? {
      workCenterCode: entry.workCenter.code,
      workCenterName: entry.workCenter.name,
      productCode: entry.product.code,
      productName: entry.product.name,
      productUnit: entry.product.unit,
      stockCategory: entry.stockCategory,
      quantity: 0,
      lines: 0
    };
    workCenterRow.quantity += entry.quantity;
    workCenterRow.lines += 1;
    workCenterRows.set(workCenterKey, workCenterRow);

    const productKey = `${entry.product.code}|${entry.stockCategory}`;
    const productRow = productRows.get(productKey) ?? {
      productCode: entry.product.code,
      productName: entry.product.name,
      productUnit: entry.product.unit,
      stockCategory: entry.stockCategory,
      quantity: 0,
      lines: 0,
      workCenterCodes: []
    };
    productRow.quantity += entry.quantity;
    productRow.lines += 1;
    if (!productRow.workCenterCodes.includes(entry.workCenter.code)) {
      productRow.workCenterCodes.push(entry.workCenter.code);
    }
    productRows.set(productKey, productRow);
  }

  const categoryOrder = (category: string): number =>
    STOCK_CATEGORIES.indexOf(category as StockCategoryKey);

  const workCenters = [...workCenterRows.values()]
    .map((row) => ({ ...row, quantity: round(row.quantity) }))
    .sort(
      (a, b) =>
        a.workCenterCode.localeCompare(b.workCenterCode, 'ru') ||
        categoryOrder(a.stockCategory) - categoryOrder(b.stockCategory) ||
        a.productCode.localeCompare(b.productCode, 'ru')
    );

  const products = [...productRows.values()]
    .map((row) => ({
      ...row,
      quantity: round(row.quantity),
      workCenterCodes: [...row.workCenterCodes].sort((a, b) => a.localeCompare(b, 'ru'))
    }))
    .sort(
      (a, b) =>
        categoryOrder(a.stockCategory) - categoryOrder(b.stockCategory) ||
        a.productCode.localeCompare(b.productCode, 'ru')
    );

  return {
    workCenters,
    products,
    totals: {
      byCategory: {
        MASS: round(byCategory.MASS ?? 0),
        PF: round(byCategory.PF ?? 0),
        GP: round(byCategory.GP ?? 0)
      },
      lines: orderLines.size,
      linesWithSecondaryConsumption
    }
  };
}

/**
 * Пояснение под таблицей — одна строка о строках, где потребление нашлось не в основном факте.
 * Текст живёт рядом с расчётом, чтобы экран не держал свою формулировку (как в T-097/T-101).
 */
export const SECONDARY_CONSUMPTION_NOTE =
  'Потребление найдено не в основном факте строки: это след данных до ОПЭ-38, когда расход писалось в каждый факт. Количество учтено, и дубли не сложены — взято максимумом.';
