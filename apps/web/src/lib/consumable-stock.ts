/**
 * Что оператор может указать в «Потреблении» (ОПЭ-34/44).
 *
 * Не вся номенклатура, а то, что реально лежит на Производственном складе категориями
 * «Масса» и «ПФ»: оператор ГП потребляет и Массу, и полуфабрикат. Позиция описывается парой
 * «номенклатура + категория остатка» — одна и та же номенклатура может лежать и Массой, и ПФ.
 *
 * Общий источник для экрана исполнения смены и карточки ПЗ (ввод за Оператора):
 * правило должно быть одно, иначе списки расходятся (ОПЭ-44).
 */
/**
 * Какие категории остатка доступны в потреблении конкретному РЦ (ОПЭ-59).
 *
 * Обычный ГП/ПФ-РЦ потребляет и Массу, и полуфабрикат. Исключение — «Маркировка ЧЗ»
 * (код 13, решение владельца 26.10.2026): она работает только с полуфабрикатом,
 * Массу ей в потребление давать нельзя.
 *
 * Правило по коду РЦ, а не по флагу в базе: так же устроено и `producesMassByCode`
 * (Массу производят 01 и 02). Если РЦ станет больше, правило переносится в справочник.
 */
export function consumptionCategoriesForWorkCenter(
  workCenterCode: string,
): Array<'MASS' | 'PF'> {
  return workCenterCode === '13' ? ['PF'] : ['MASS', 'PF'];
}

/** Оставляет в списке только те категории, которые РЦ вправе потреблять. */
export function filterConsumableForWorkCenter<T extends { category: 'MASS' | 'PF' | 'GP' }>(
  items: T[],
  workCenterCode: string,
): T[] {
  const allowed = consumptionCategoriesForWorkCenter(workCenterCode);
  return items.filter((item) => allowed.includes(item.category as 'MASS' | 'PF'));
}

export interface ConsumableStockItem {
  id: string;
  code: string;
  name: string;
  unit: string;
  category: 'MASS' | 'PF' | 'GP';
  available: number;
}

interface StockReader {
  stockBalance: {
    findMany: (args: {
      where: Record<string, unknown>;
      include: { product: true };
      orderBy: Record<string, unknown>;
    }) => Promise<
      Array<{
        productId: string;
        stockCategory: 'MASS' | 'PF' | 'GP';
        quantity: unknown;
        product: { code: string; name: string; unit: string };
      }>
    >;
  };
}

export async function getConsumableStock(client: StockReader): Promise<ConsumableStockItem[]> {
  const balances = await client.stockBalance.findMany({
    where: {
      warehouse: { type: 'PRODUCTION' },
      stockCategory: { in: ['MASS', 'PF'] },
      quantity: { gt: 0 },
    },
    include: { product: true },
    orderBy: { product: { name: 'asc' } },
  });

  return balances.map((balance) => ({
    id: balance.productId,
    code: balance.product.code,
    name: balance.product.name,
    unit: balance.product.unit,
    category: balance.stockCategory,
    available: Number(balance.quantity),
  }));
}
