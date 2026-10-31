import { describe, it, expect, vi } from 'vitest';
import {
  filterKanbanCardsForRoles,
  getKanbanBoard,
  visibleKanbanColumns,
  type KanbanCard,
} from '../board';

/**
 * Данные доски контура (T-103, этап 3).
 *
 * Здесь проверяется то, что нельзя проверить в чистой функции этапа: запросы, фильтры
 * и права ролей. Крайние случаи этапа (отмены, DISCREPANCY, разные строки одного ПЗ)
 * покрыты в `stage.test.ts` — там же, где сама логика.
 */

const DAY_SHIFT = {
  id: 'shift-1',
  number: 1,
  date: new Date('2026-10-30T00:00:00'),
  start: '08:00',
  end: '20:00',
};

function gpLine(overrides: Record<string, unknown> = {}) {
  return {
    id: 'line-1',
    plannedQuantity: { toString: () => '40' },
    status: 'REPORTED',
    operator: { fullName: 'Иванов И.И.' },
    workCenter: { code: '03', name: 'Тубировка крем' },
    product: { code: 'GP002', name: 'Готовая продукция Б', unit: 'шт' },
    facts: [{ factCategory: 'GP', quantity: { toString: () => '45' } }],
    order: { id: 'po-12345678', status: 'COMPLETED', shiftId: DAY_SHIFT.id },
    transferLines: [],
    ...overrides,
  };
}

function fakeClient(input: {
  shifts?: unknown[];
  lines?: unknown[];
  tasks?: unknown[];
}) {
  return {
    shift: { findMany: vi.fn().mockResolvedValue(input.shifts ?? [DAY_SHIFT]) },
    productionOrderLine: { findMany: vi.fn().mockResolvedValue(input.lines ?? []) },
    taskForOneC: { findMany: vi.fn().mockResolvedValue(input.tasks ?? []) },
  };
}

describe('доска: сборка и фильтры', () => {
  it('строит карточку строки: подписи, план/факт, этап и ссылка', async () => {
    const board = await getKanbanBoard(fakeClient({ lines: [gpLine()] }), {}, {
      now: new Date('2026-10-30T10:00:00'),
    });

    expect(board.shift?.id).toBe('shift-1');
    expect(board.cards).toHaveLength(1);
    expect(board.cards[0]).toMatchObject({
      lineId: 'line-1',
      orderLabel: 'ПЗ po-12345',
      workCenterCode: '03',
      productCode: 'GP002',
      plan: 40,
      fact: 45,
      operatorName: 'Иванов И.И.',
      column: 'CLOSED',
      note: 'ожидает 1С',
      // Клик ведёт на экран действия, а не меняет статус.
      href: '/production-orders/po-12345678#line-line-1',
    });
  });

  it('перемещение уводит карточку в колонки перемещений и даёт ссылку на перемещение', async () => {
    const board = await getKanbanBoard(
      fakeClient({
        lines: [
          gpLine({
            transferLines: [
              {
                id: 'tl-1',
                goodsTransfer: {
                  id: 'tr-1',
                  status: 'SUBMITTED',
                  sourceWarehouseId: 'wh-prod',
                  destinationWarehouseId: 'wh-gp',
                },
              },
            ],
          }),
        ],
      }),
      {},
      { now: new Date('2026-10-30T10:00:00') },
    );

    expect(board.cards[0]).toMatchObject({
      column: 'TRANSFER_SUBMITTED',
      transferId: 'tr-1',
      href: '/transfers/tr-1',
    });
  });

  it('фильтр по смене смотрит только эту смену', async () => {
    const client = fakeClient({});
    await getKanbanBoard(client, { shiftId: 'shift-1' }, { now: new Date('2026-10-30T10:00:00') });

    expect(client.productionOrderLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ order: { shiftId: 'shift-1' } }) }),
    );
  });

  it('фильтры РЦ и номенклатуры уходят в запрос строк', async () => {
    const client = fakeClient({});
    await getKanbanBoard(
      client,
      { shiftId: 'shift-1', workCenterId: 'wc-03', productId: 'gp-1' },
      { now: new Date('2026-10-30T10:00:00') },
    );

    const where = (client.productionOrderLine.findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where).toMatchObject({ workCenterId: 'wc-03', productId: 'gp-1' });
  });

  it('склад фильтрует только колонки перемещений: карточку ПЗ он не скрывает', async () => {
    const board = await getKanbanBoard(
      fakeClient({ lines: [gpLine()] }),
      { warehouseId: 'wh-gp' },
      { now: new Date('2026-10-30T10:00:00') },
    );

    // Карточка в колонке «Закрыто» (ПЗ) — склада у строки нет, скрывать нечего.
    expect(board.cards).toHaveLength(1);
    expect(board.cards[0].column).toBe('CLOSED');
  });

  it('склад скрывает перемещение чужого склада', async () => {
    const line = gpLine({
      transferLines: [
        {
          id: 'tl-1',
          goodsTransfer: {
            id: 'tr-1',
            status: 'RECEIVED',
            sourceWarehouseId: 'wh-prod',
            destinationWarehouseId: 'wh-other',
          },
        },
      ],
    });

    const own = await getKanbanBoard(fakeClient({ lines: [line] }), { warehouseId: 'wh-other' }, {
      now: new Date('2026-10-30T10:00:00'),
    });
    const foreign = await getKanbanBoard(fakeClient({ lines: [line] }), { warehouseId: 'wh-gp' }, {
      now: new Date('2026-10-30T10:00:00'),
    });

    expect(own.cards).toHaveLength(1);
    expect(foreign.cards).toHaveLength(0);
  });

  it('смен нет — пустая доска без падения', async () => {
    const board = await getKanbanBoard(fakeClient({ shifts: [] }), {}, {
      now: new Date('2026-10-30T10:00:00'),
    });

    expect(board.shift).toBeNull();
    expect(board.cards).toEqual([]);
  });

  // Требование главной линии: строка в ПЗ, где одна строка отчиталась, а другая нет.
  it('строки одного ПЗ расходятся по разным колонкам', async () => {
    const board = await getKanbanBoard(
      fakeClient({
        lines: [
          gpLine({ id: 'line-1', status: 'REPORTED', order: { id: 'po-1', status: 'IN_PROGRESS', shiftId: 'shift-1' } }),
          gpLine({ id: 'line-2', status: 'ACCEPTED', order: { id: 'po-1', status: 'IN_PROGRESS', shiftId: 'shift-1' } }),
        ],
      }),
      {},
      { now: new Date('2026-10-30T10:00:00') },
    );

    const byLine = Object.fromEntries(board.cards.map((card) => [card.lineId, card.column]));
    expect(byLine).toEqual({ 'line-1': 'REPORTED', 'line-2': 'IN_PROGRESS' });
  });

  it('подпись «проведено» берётся из задачи 1С по ПЗ', async () => {
    const board = await getKanbanBoard(
      fakeClient({ lines: [gpLine()], tasks: [{ sourceId: 'po-12345678', status: 'PROCESSED' }] }),
      {},
      { now: new Date('2026-10-30T10:00:00') },
    );

    expect(board.cards[0]).toMatchObject({ column: 'CLOSED', note: 'проведено' });
  });
});

describe('доска: права ролей', () => {
  it('складские роли не видят колонок ПЗ, а НП и ОТК видят все', () => {
    expect(visibleKanbanColumns(['KSGP']).map((column) => column.key)).toEqual([
      'TRANSFER_DRAFT',
      'TRANSFER_SUBMITTED',
      'RECEIVED',
      'DISCREPANCY',
      'CANCELLED',
    ]);
    expect(visibleKanbanColumns(['USGP'])).toHaveLength(5);
    expect(visibleKanbanColumns(['NP'])).toHaveLength(10);
    expect(visibleKanbanColumns(['OTK'])).toHaveLength(10);
  });

  it('карточки колонок ПЗ складской роли не показываются', () => {
    const cards = [
      { column: 'CLOSED', cancelledBy: null },
      { column: 'RECEIVED', cancelledBy: null },
    ] as KanbanCard[];

    expect(filterKanbanCardsForRoles(cards, ['KSGP']).map((card) => card.column)).toEqual(['RECEIVED']);
    expect(filterKanbanCardsForRoles(cards, ['NP'])).toHaveLength(2);
  });

  it('отменённое ПЗ складской роли не показывается, отменённое перемещение — показывается', () => {
    const cards = [
      { column: 'CANCELLED', cancelledBy: 'order' },
      { column: 'CANCELLED', cancelledBy: 'transfer' },
    ] as KanbanCard[];

    expect(filterKanbanCardsForRoles(cards, ['KSGP']).map((card) => card.cancelledBy)).toEqual([
      'transfer',
    ]);
    expect(filterKanbanCardsForRoles(cards, ['OTK'])).toHaveLength(2);
  });
});
