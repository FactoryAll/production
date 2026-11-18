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

/**
 * Проверка «что можно в потребление этому РЦ» для серверных путей (14.11.2026).
 *
 * Повод: правило «Маркировка ЧЗ (код 13) — только ПФ» стояло в одном серверном файле
 * (`shift-execution/actions.ts`), а пути карточки ПЗ — «Ввести за Оператора» и корректировка
 * НП — его не проверяли. Интерфейс список скрывал, но сервер принимал Массу, если строка
 * пришла из уже сохранённого факта. Теперь правило одно и применяется везде, где пишется
 * потребление (ОПЭ-59, урок ОПЭ-70/71: правило должно жить в одном месте).
 */
export function assertConsumptionAllowedForWorkCenter(
  workCenterCode: string,
  consumption: Array<{ stockCategory?: 'MASS' | 'PF' | 'GP' }>,
): void {
  // 18.11.2026: запрет — ТОЛЬКО про «Маркировку ЧЗ» (решение владельца: она потребляет
  // лишь полуфабрикат). Первая версия проверки сравнивала категорию со списком «Масса/ПФ»
  // и отбивала `GP` — а `GP` это значение по умолчанию у строк потребления, заведённых
  // раньше. Из-за этого НП не мог сохранить корректировку потребления на обычном РЦ.
  if (workCenterCode !== '13') {
    return;
  }
  const notPf = consumption.find((item) => item.stockCategory !== undefined && item.stockCategory !== 'PF');
  if (notPf) {
    throw new Error('РЦ «Маркировка ЧЗ» потребляет только полуфабрикат (ПФ)');
  }
}

/**
 * Какие категории РЦ ПРОИЗВОДИТ (14.11.2026, решение владельца).
 *
 * «Маркировка ЧЗ» (код 13) без вариантов: потребляет только ПФ, **производит только ГП**.
 * Обычный ГП/ПФ-РЦ производит обе категории — оператор сам решает, что заявить.
 *
 * Правило по коду РЦ, рядом с правилом потребления: обе стороны («что можно списать»
 * и «что можно заявить») должны читаться в одном месте, иначе форма и сервер разойдутся.
 */
export function productionCategoriesForWorkCenter(
  workCenterCode: string,
): Array<'GP' | 'PF'> {
  return workCenterCode === '13' ? ['GP'] : ['GP', 'PF'];
}

/** Разрешён ли выпуск ПФ на этом РЦ. */
export function producesPf(workCenterCode: string): boolean {
  return productionCategoriesForWorkCenter(workCenterCode).includes('PF');
}

/**
 * Проверка «что этот РЦ может заявить в выпуске» для серверных путей.
 * Симметрична `assertConsumptionAllowedForWorkCenter`.
 */
export function assertOutputAllowedForWorkCenter(
  workCenterCode: string,
  outputByCategory: Partial<Record<'GP' | 'PF' | 'MASS', unknown>>,
): void {
  if (!producesPf(workCenterCode) && outputByCategory.PF !== undefined && outputByCategory.PF !== null) {
    throw new Error('РЦ «Маркировка ЧЗ» выпускает только готовую продукцию (ГП)');
  }
}


/**
 * ПФ в потреблении — только той номенклатуры, которую производит строка (18.11.2026).
 *
 * Повод: в ПЗ 3b9355c7 «Спрей АНТИБАКТЕР» списали полуфабрикатом 12 095, хотя ПФ этой
 * номенклатуры никто не производил — на складе лежало 960, остаток ушёл в −11 135.
 * Причина: в списке потребления предлагались ПФ всех номенклатур.
 *
 * Правило: Масса — любая (это отдельные продукты), ПФ — только продукт строки.
 * На «Маркировке ЧЗ» (код 13) к тому же только ПФ, без Массы.
 */
export function assertConsumptionMatchesLineProduct(
  workCenterCode: string,
  lineProductId: string,
  consumption: Array<{ productId: string; stockCategory?: 'MASS' | 'PF' | 'GP' }>,
): void {
  for (const item of consumption) {
    if (item.stockCategory === 'PF' && item.productId !== lineProductId) {
      throw new Error(
        'Полуфабрикат в потреблении должен быть той номенклатуры, которая производится в этой строке',
      );
    }
    if (workCenterCode === '13' && item.stockCategory === 'MASS') {
      throw new Error('РЦ «Маркировка ЧЗ» потребляет только полуфабрикат (ПФ)');
    }
  }
}

/** Какие категории остатка предлагать для позиции потребления (клиенту). */
export function isConsumptionOptionAllowed(
  workCenterCode: string,
  lineProductId: string,
  optionProductId: string,
  optionCategory: 'MASS' | 'PF' | 'GP',
): boolean {
  if (!consumptionCategoriesForWorkCenter(workCenterCode).includes(optionCategory as 'MASS' | 'PF')) {
    return false;
  }
  if (optionCategory === 'PF') {
    return optionProductId === lineProductId;
  }
  return true;
}
