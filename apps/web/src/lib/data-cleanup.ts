// Очистка тестовых данных из интерфейса администратора (T-076, решение владельца 06.10.2026).
//
// Чистятся только операционные данные — документы и всё, что из них следует: ПЗ, факты и итоги
// смен, перемещения с расхождениями, остатки, задачи для 1С, уведомления, хронометраж.
//
// НЕ трогаются: справочники (РЦ, номенклатура, сотрудники, склады, смены, причины), пользователи,
// роли и права, а также журнал аудита — он ведётся append-only (M13 BR-1), и сама очистка в него
// только дописывается. После очистки система остаётся полностью рабочей: пустыми становятся
// документы, а не система.

import type { TxClient } from '@prodtrack/db';

export interface DataGroup {
  key: string;
  label: string;
  /** Что именно удаляется — показывается администратору. */
  description: string;
  /** Порядок удаления: зависимые данные удаляются раньше (иначе база откажет по внешним ключам). */
  order: number;
  count: (client: TxClient) => Promise<number>;
  remove: (client: TxClient) => Promise<number>;
}

/** Слово, которое администратор вводит для подтверждения: случайный клик не сработает. */
export const CLEAR_CONFIRMATION_WORD = 'ОЧИСТИТЬ';

/** Постоянные группы. Остатки добавляются отдельно — по одной на каждый склад. */
const BASE_DATA_GROUPS: DataGroup[] = [
  {
    key: 'notifications',
    label: 'Уведомления',
    description: 'Входящие уведомления пользователей (M09)',
    order: 1,
    count: async (client) => client.notification.count(),
    remove: async (client) => (await client.notification.deleteMany()).count,
  },
  {
    key: 'timings',
    label: 'Хронометраж',
    description: 'Записи статусных переходов документов и строк (M10)',
    order: 2,
    count: async (client) => client.stageTiming.count(),
    remove: async (client) => (await client.stageTiming.deleteMany()).count,
  },
  {
    key: 'oneC',
    label: 'Задачи для 1С',
    description: 'Задачи «Производство» и «Перемещение» (M12)',
    order: 3,
    count: async (client) => client.taskForOneC.count(),
    remove: async (client) => (await client.taskForOneC.deleteMany()).count,
  },
  {
    key: 'transfers',
    label: 'Перемещения',
    description: 'Перемещения ГП вместе со строками и расхождениями (M07, M08)',
    order: 4,
    count: async (client) =>
      (await client.goodsTransfer.count()) +
      (await client.transferLine.count()) +
      (await client.discrepancy.count()),
    // Строки и расхождения уходят каскадом вместе с документом.
    remove: async (client) => {
      const { count } = await client.goodsTransfer.deleteMany();
      return count;
    },
  },
  {
    key: 'facts',
    label: 'Факты производства',
    description: 'Внесённый факт смены вместе с потреблением (M04, Р-10)',
    order: 5,
    count: async (client) =>
      (await client.productionFact.count()) + (await client.factConsumption.count()),
    remove: async (client) => {
      const { count } = await client.productionFact.deleteMany();
      return count;
    },
  },
  {
    key: 'summaries',
    label: 'Итоги смен',
    description: 'Сводные итоги по РЦ вместе с потреблением (M06)',
    order: 6,
    count: async (client) =>
      (await client.shiftSummary.count()) + (await client.shiftSummaryConsumption.count()),
    remove: async (client) => {
      const { count } = await client.shiftSummary.deleteMany();
      return count;
    },
  },
  // Остатки — не одной группой, а отдельной на каждый склад: их список строится
  // по справочнику складов в buildDataGroups (замечание владельца продукта 12.10.2026).
  {
    key: 'orders',
    label: 'Производственные задания',
    description: 'ПЗ вместе со строками, работниками и фактами этих строк (M03, M04)',
    order: 8,
    count: async (client) =>
      (await client.productionOrder.count()) +
      (await client.productionOrderLine.count()) +
      (await client.productionOrderLineWorkers.count()),
    // Строки, назначения работников и факты уходят каскадом вместе с ПЗ.
    remove: async (client) => {
      const { count } = await client.productionOrder.deleteMany();
      return count;
    },
  },
];

/** Ключ группы остатков конкретного склада. */
export const STOCK_GROUP_PREFIX = 'stock:';

export interface WarehouseRef {
  id: string;
  name: string;
}

/**
 * Полный список групп: постоянные плюс отдельная группа остатков на каждый склад.
 *
 * Склады — данные, а не константы, поэтому список строится по справочнику: администратор
 * может почистить остатки одного склада, не трогая другой.
 */
export function buildDataGroups(warehouses: WarehouseRef[]): DataGroup[] {
  const stockGroups: DataGroup[] = warehouses.map((warehouse) => ({
    key: STOCK_GROUP_PREFIX + warehouse.id,
    label: 'Остатки — ' + warehouse.name,
    description: 'Движения и остатки склада «' + warehouse.name + '» (M05)',
    order: 7,
    count: async (client) =>
      (await client.stockMovement.count({ where: { warehouseId: warehouse.id } })) +
      (await client.stockBalance.count({ where: { warehouseId: warehouse.id } })),
    remove: async (client) => {
      const movements = await client.stockMovement.deleteMany({
        where: { warehouseId: warehouse.id },
      });
      const balances = await client.stockBalance.deleteMany({
        where: { warehouseId: warehouse.id },
      });
      return movements.count + balances.count;
    },
  }));

  return [...BASE_DATA_GROUPS, ...stockGroups].sort((left, right) => left.order - right.order);
}

export function findDataGroups(keys: string[], warehouses: WarehouseRef[]): DataGroup[] {
  const known = new Map(buildDataGroups(warehouses).map((group) => [group.key, group]));
  return keys
    .map((key) => known.get(key))
    .filter((group): group is DataGroup => group !== undefined)
    .sort((left, right) => left.order - right.order);
}

export interface DataGroupCount {
  key: string;
  label: string;
  description: string;
  records: number;
}

/** Сколько записей удалит каждая группа — показывается администратору ДО подтверждения. */
export async function countDataGroups(client: TxClient): Promise<DataGroupCount[]> {
  const warehouses = await client.warehouse.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });

  const counts: DataGroupCount[] = [];
  for (const group of buildDataGroups(warehouses)) {
    counts.push({
      key: group.key,
      label: group.label,
      description: group.description,
      records: await group.count(client),
    });
  }
  return counts;
}
