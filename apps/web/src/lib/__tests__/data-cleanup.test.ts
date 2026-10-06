import { describe, it, expect, vi } from 'vitest';
import { CLEAR_CONFIRMATION_WORD, DATA_GROUPS, countDataGroups, findDataGroups } from '../data-cleanup';

describe('Очистка данных: состав групп (T-076)', () => {
  it('не включает справочники, пользователей и журнал аудита', () => {
    const keys = DATA_GROUPS.map((group) => group.key);

    expect(keys).toEqual(['notifications', 'timings', 'oneC', 'transfers', 'facts', 'summaries', 'stock', 'orders']);
    expect(keys).not.toContain('audit');
    expect(keys).not.toContain('nsi');
  });

  it('порядок групп — по зависимостям: документы удаляются после того, что на них ссылается', () => {
    const orderOf = (key: string) => findDataGroups([key])[0].order;

    expect(orderOf('facts')).toBeLessThan(orderOf('orders'));
    expect(orderOf('summaries')).toBeLessThan(orderOf('orders'));
  });

  it('выбирает только известные группы и сортирует их по порядку удаления', () => {
    const groups = findDataGroups(['orders', 'unknown', 'notifications']);

    expect(groups.map((group) => group.key)).toEqual(['notifications', 'orders']);
  });

  it('пустой выбор даёт пустой список — очистить ничего нельзя', () => {
    expect(findDataGroups([])).toEqual([]);
    expect(findDataGroups(['nope'])).toEqual([]);
  });

  it('показывает число записей по каждой группе до подтверждения', async () => {
    const client = {
      notification: { count: vi.fn().mockResolvedValue(3) },
      stageTiming: { count: vi.fn().mockResolvedValue(2) },
      taskForOneC: { count: vi.fn().mockResolvedValue(1) },
      goodsTransfer: { count: vi.fn().mockResolvedValue(0) },
      transferLine: { count: vi.fn().mockResolvedValue(0) },
      discrepancy: { count: vi.fn().mockResolvedValue(0) },
      productionFact: { count: vi.fn().mockResolvedValue(0) },
      factConsumption: { count: vi.fn().mockResolvedValue(0) },
      shiftSummary: { count: vi.fn().mockResolvedValue(0) },
      shiftSummaryConsumption: { count: vi.fn().mockResolvedValue(0) },
      stockMovement: { count: vi.fn().mockResolvedValue(0) },
      stockBalance: { count: vi.fn().mockResolvedValue(0) },
      productionOrder: { count: vi.fn().mockResolvedValue(0) },
      productionOrderLine: { count: vi.fn().mockResolvedValue(0) },
      productionOrderLineWorkers: { count: vi.fn().mockResolvedValue(0) },
    } as never;

    const counts = await countDataGroups(client);

    expect(counts.map((group) => group.key)).toEqual(DATA_GROUPS.map((group) => group.key));
    expect(counts[0]).toMatchObject({ key: 'notifications', label: 'Уведомления', records: 3 });
    expect(counts[1].records).toBe(2);
  });

  it('подтверждение вводится словом, чтобы очистка не сработала случайным кликом', () => {
    expect(CLEAR_CONFIRMATION_WORD).toBe('ОЧИСТИТЬ');
  });
});
