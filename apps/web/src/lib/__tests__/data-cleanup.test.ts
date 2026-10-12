import { describe, it, expect, vi } from 'vitest';
import {
  CLEAR_CONFIRMATION_WORD,
  buildDataGroups,
  countDataGroups,
  findDataGroups,
} from '../data-cleanup';

const WAREHOUSES = [
  { id: 'wh-production', name: 'Производственный' },
  { id: 'wh-fg', name: 'Склад ГП' },
];

const KEYS = [
  'notifications',
  'timings',
  'oneC',
  'transfers',
  'facts',
  'summaries',
  'stock:wh-production',
  'stock:wh-fg',
  'orders',
];

function emptyClient() {
  const counter = () => ({ count: vi.fn().mockResolvedValue(0) });
  return {
    notification: counter(),
    stageTiming: counter(),
    taskForOneC: counter(),
    goodsTransfer: counter(),
    transferLine: counter(),
    discrepancy: counter(),
    productionFact: counter(),
    factConsumption: counter(),
    shiftSummary: counter(),
    shiftSummaryConsumption: counter(),
    stockMovement: counter(),
    stockBalance: counter(),
    productionOrder: counter(),
    productionOrderLine: counter(),
    productionOrderLineWorkers: counter(),
  } as never;
}

describe('Очистка данных: состав групп (T-076)', () => {
  it('не включает справочники, пользователей и журнал аудита', () => {
    const keys = buildDataGroups(WAREHOUSES).map((group) => group.key);

    expect(keys).toEqual(KEYS);
    expect(keys).not.toContain('audit');
    expect(keys).not.toContain('nsi');
  });

  it('остатки чистятся по складам: группа на каждый склад из справочника', () => {
    const groups = buildDataGroups(WAREHOUSES).filter((group) => group.key.startsWith('stock:'));

    expect(groups.map((group) => group.label)).toEqual([
      'Остатки — Производственный',
      'Остатки — Склад ГП',
    ]);
  });

  it('удаление остатков ограничено своим складом', async () => {
    const client = emptyClient() as unknown as {
      stockMovement: { deleteMany: ReturnType<typeof vi.fn> };
      stockBalance: { deleteMany: ReturnType<typeof vi.fn> };
    };
    client.stockMovement.deleteMany = vi.fn().mockResolvedValue({ count: 3 });
    client.stockBalance.deleteMany = vi.fn().mockResolvedValue({ count: 2 });

    const group = findDataGroups(['stock:wh-fg'], WAREHOUSES)[0];
    const removed = await group.remove(client as never);

    expect(removed).toBe(5);
    expect(client.stockMovement.deleteMany).toHaveBeenCalledWith({
      where: { warehouseId: 'wh-fg' },
    });
    expect(client.stockBalance.deleteMany).toHaveBeenCalledWith({
      where: { warehouseId: 'wh-fg' },
    });
  });

  it('порядок групп — по зависимостям: документы удаляются после того, что на них ссылается', () => {
    const orderOf = (key: string) => findDataGroups([key], WAREHOUSES)[0].order;

    expect(orderOf('facts')).toBeLessThan(orderOf('orders'));
    expect(orderOf('summaries')).toBeLessThan(orderOf('orders'));
  });

  it('выбирает только известные группы и сортирует их по порядку удаления', () => {
    const groups = findDataGroups(['orders', 'unknown', 'notifications'], WAREHOUSES);

    expect(groups.map((group) => group.key)).toEqual(['notifications', 'orders']);
  });

  it('пустой выбор даёт пустой список — очистить ничего нельзя', () => {
    expect(findDataGroups([], WAREHOUSES)).toEqual([]);
    expect(findDataGroups(['nope'], WAREHOUSES)).toEqual([]);
  });

  it('показывает число записей по каждой группе до подтверждения', async () => {
    const client = emptyClient() as unknown as Record<string, { count: ReturnType<typeof vi.fn> }>;
    client.warehouse = {
      findMany: vi.fn().mockResolvedValue(WAREHOUSES),
    } as never;
    client.notification.count.mockResolvedValue(3);
    client.stageTiming.count.mockResolvedValue(2);

    const counts = await countDataGroups(client as never);

    expect(counts.map((group) => group.key)).toEqual(KEYS);
    expect(counts[0]).toMatchObject({ key: 'notifications', label: 'Уведомления', records: 3 });
    expect(counts[1].records).toBe(2);
  });

  it('подтверждение вводится словом, чтобы очистка не сработала случайным кликом', () => {
    expect(CLEAR_CONFIRMATION_WORD).toBe('ОЧИСТИТЬ');
  });
});
