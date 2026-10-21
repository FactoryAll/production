/**
 * Чистые хелперы для подсчёта доступного остатка в форме Перемещения.
 *
 * ВАЖНО: модуль не должен содержать директиивы 'use server' — он импортируется
 * в клиентские компоненты и вызывается во время рендера.
 */

/** warehouseId -> productId -> доступное количество. */
export type StockByWarehouse = Record<string, Record<string, number>>;

export interface StockBalanceRow {
  warehouseId: string;
  productId: string;
  quantity: unknown;
}

export function buildStockByWarehouse(rows: StockBalanceRow[]): StockByWarehouse {
  const result: StockByWarehouse = {};
  for (const row of rows) {
    const byProduct = result[row.warehouseId] ?? (result[row.warehouseId] = {});
    byProduct[row.productId] = Number(row.quantity);
  }
  return result;
}

/**
 * Доступное количество продукта на складе.
 *
 * `extraAvailable` — количество, уже зарезервированное этим же Перемещением
 * (например, уже списанное при отправке), чтобы правка документа не считалась
 * превышением остатка.
 */
export function getAvailableQuantity(
  stockByWarehouse: StockByWarehouse,
  warehouseId: string,
  productId: string,
  extraAvailable = 0,
): number {
  if (!warehouseId || !productId) {
    return extraAvailable;
  }
  const quantity = stockByWarehouse[warehouseId]?.[productId] ?? 0;
  return quantity + extraAvailable;
}

export function parseQuantityInput(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (normalized === '') {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isQuantityOverAvailable(quantity: number | null, available: number): boolean {
  return quantity !== null && quantity > available;
}

export function formatQuantity(value: number): string {
  return value.toFixed(2);
}

/**
 * Продукция, доступная для выбора на складе-источнике.
 
 * В выпадающем списке остаётся только то, что реально лежит на выбранном складе:
 * позицию с нулевым остатком сервер всё равно отклонит на отправке (BR-1), и предлагать
 * её значит вести пользователя к ошибке (ОПЭ-27, проверено на проде 21.10.2026).
 *
 * `keepIds` — позиции, уже выбранные в строках документа: они остаются в списке всегда,
 * иначе при правке поле выглядело бы пустым, хотя продукт в строке есть.
 */
export function filterProductsBySource<T extends { id: string }>(
  products: T[],
  stockByWarehouse: StockByWarehouse,
  sourceWarehouseId: string,
  keepIds: string[] = [],
): T[] {
  const keep = new Set(keepIds.filter((id) => id !== ''));
  return products.filter(
    (product) =>
      keep.has(product.id) ||
      (sourceWarehouseId !== '' &&
        getAvailableQuantity(stockByWarehouse, sourceWarehouseId, product.id) > 0),
  );
}
