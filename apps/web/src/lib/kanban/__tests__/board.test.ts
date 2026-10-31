import { describe, it, expect, vi } from 'vitest';
import {
  filterKanbanCardsForRoles,
  getKanbanBoard,
  visibleKanbanColumns,
  type KanbanCard,
} from '../board';

/**
 * Данные доски контура (T-103).
 *
 * Модель после решения владельца 31.10.2026: колонки 1–5 — строки РЦ (этап по ПЗ и строке),
 * колонки 6–9 — **самостоятельные** карточки перемещений, отбор по дате документа в окне
 * выбранной смены. Привязки перемещения к строке ПЗ нет.
 */

const DAY_SHIFT = {
  id: 'shift-1',
  number: 1,
  date: new Date('2026-10-30T00:00:00'),
  start: '08:00',
  end: '20:00',
};

const SECOND_SHIFT = {
  id: 'shift-2',
  number: 2,
  date: new Date('2026-10-31T00:00:00'),
  start: '08:00',
  end: '20:00',
};

/**
 * Мок честно применяет условия выборки: иначе тесты про срез по смене проходили бы
 * и без фильтра в запросе. Перемещения фильтруем по дате окна так же, как настоящий код.
 */
function fakeClient(input: {
  shifts?: unknown[];
  lines?: unknown[];
  tasks?: unknown[];
  transfers?: unknown[];
}) {
  const findLines = vi.fn(async (args: unknown) => {
    const where = (args as { where?: Record<string, unknown> } | undefined)?.where ?? {};
    const order = (where.order ?? {}) as { shiftId?: string };
    return (input.lines ?? []).filter((line) => {
      const typed = line as { order: { shiftId: string } };
      return !order.shiftId || typed.order.shiftId === order.shiftId;
    });
  });

  const client = {
    shift: { findMany: vi.fn().mockResolvedValue(input.shifts ?? [DAY_SHIFT]) },
    productionOrderLine: { findMany: findLines },
    taskForOneC: { findMany: vi.fn().mockResolvedValue(input.tasks ?? []) },
    goodsTransfer: { findMany: vi.fn().mockResolvedValue(input.transfers ?? []) },
  };
  return { client: client as unknown as Parameters<typeof getKanbanBoard>[0], findLines };
}

const NOW = new Date('2026-10-30T10:00:00');

function gpLine(overrides: Record<string, unknown> = {}) {
  return {
    id: 'line-1',
    productId: 'gp-2',
    workCenterId: 'wc-03',
    plannedQuantity: { toString: () => '40' },
    status: 'REPORTED',
    operator: { fullName: 'Иванов И.И.' },
    workCenter: { code: '03', name: 'Тубировка крем' },
    product: { id: 'gp-2', code: 'GP002', name: 'Готовая продукция Б', unit: 'шт' },
    facts: [{ factCategory: 'GP', quantity: { toString: () => '45' } }],
    order: { id: 'po-12345678', status: 'COMPLETED', shiftId: DAY_SHIFT.id },
    ...overrides,
  };
}

function transfer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tr-1',
    status: 'DRAFT',
    createdAt: new Date('2026-10-30T09:00:00'),
    updatedAt: new Date('2026-10-30T09:00:00'),
    submittedAt: null,
    sourceWarehouse: { id: 'wh-prod', name: 'Производственный склад' },
    destinationWarehouse: { id: 'wh-gp', name: 'Склад ГП' },
    lines: [
      {
        product: { id: 'gp-2', code: 'GP002', name: 'Готовая продукция Б', unit: 'шт' },
        plannedQuantity: { toString: () => '10' },
        actualQuantity: null,
        discrepancies: [],
      },
    ],
    ...overrides,
  };
}

describe('доска: строки РЦ (колонки 1–5)', () => {
  it('строка закрытого ПЗ попадает в «Закрыто» с подписью про 1С', async () => {
    const { client } = fakeClient({ lines: [gpLine()] });
    const board = await getKanbanBoard(client, {}, { now: NOW });

    expect(board.cards).toHaveLength(1);
    expect(board.cards[0]).toMatchObject({
      kind: 'line',
      column: 'CLOSED',
      note: 'ожидает 1С',
      noteTone: 'rose',
      href: '/production-orders/po-12345678#line-line-1',
    });
  });

  it('строки одного ПЗ расходятся по колонкам', async () => {
    const { client } = fakeClient({
      lines: [
        gpLine({ id: 'line-1', status: 'REPORTED', order: { id: 'po-1', status: 'IN_PROGRESS', shiftId: 'shift-1' } }),
        gpLine({ id: 'line-2', status: 'ACCEPTED', order: { id: 'po-1', status: 'IN_PROGRESS', shiftId: 'shift-1' } }),
      ],
    });
    const board = await getKanbanBoard(client, {}, { now: NOW });

    const byLine = Object.fromEntries(
      board.cards
        .filter((card) => card.kind === 'line')
        .map((card) => [(card as unknown as { lineId: string }).lineId, card.column]),
    );
    expect(byLine).toEqual({ 'line-1': 'REPORTED', 'line-2': 'IN_PROGRESS' });
  });

  it('срез по смене: строка другой смены в этот срез не попадает', async () => {
    const { client } = fakeClient({
      lines: [gpLine({ order: { id: 'po-2', status: 'COMPLETED', shiftId: 'shift-2' } })],
    });
    const board = await getKanbanBoard(client, { shiftId: 'shift-1' }, { now: NOW });

    expect(board.cards.filter((card) => card.kind === 'line')).toHaveLength(0);
  });
});

describe('доска: перемещения (колонки 6–9)', () => {
  it('черновик — «Перемещение создано»: номенклатура, количество, склады, ссылка', async () => {
    const { client } = fakeClient({ transfers: [transfer()] });
    const board = await getKanbanBoard(client, {}, { now: NOW });

    expect(board.cards.find((item) => item.kind === 'transfer')).toMatchObject({
      kind: 'transfer',
      transferId: 'tr-1',
      column: 'TRANSFER_DRAFT',
      productCode: 'GP002',
      quantity: 10,
      sourceWarehouseName: 'Производственный склад',
      destinationWarehouseName: 'Склад ГП',
      href: '/transfers/tr-1',
    });
  });

  it('отправленное — «Отправлено» с пометкой «в пути»', async () => {
    const { client } = fakeClient({
      transfers: [
        transfer({
          status: 'SUBMITTED',
          submittedAt: new Date('2026-10-30T12:00:00'),
          updatedAt: new Date('2026-10-30T12:00:00'),
        }),
      ],
    });
    const board = await getKanbanBoard(client, {}, { now: NOW });

    expect(board.cards.find((item) => item.kind === 'transfer')).toMatchObject({
      column: 'TRANSFER_SUBMITTED',
      note: 'в пути',
      // Тон — из данных, а не из текста пометки: «в пути» — светло-песочный.
      noteTone: 'sand',
    });
  });

  it('принятое и согласованное — «Принято складом»', async () => {
    const received = fakeClient({
      transfers: [transfer({ status: 'RECEIVED', updatedAt: new Date('2026-10-30T15:00:00') })],
    });
    const receivedBoard = await getKanbanBoard(received.client, {}, { now: NOW });
    expect(receivedBoard.cards.find((item) => item.kind === 'transfer')).toMatchObject({
      column: 'RECEIVED',
      note: null,
    });

    const reconciled = fakeClient({
      transfers: [transfer({ status: 'RECONCILED', updatedAt: new Date('2026-10-30T16:00:00') })],
    });
    const reconciledBoard = await getKanbanBoard(reconciled.client, {}, { now: NOW });
    expect(reconciledBoard.cards.find((item) => item.kind === 'transfer')).toMatchObject({
      column: 'RECEIVED',
      note: 'расхождение согласовано',
      noteTone: 'mint',
    });
  });

  it('расхождение — отдельная колонка', async () => {
    const { client } = fakeClient({
      transfers: [transfer({ status: 'DISCREPANCY', updatedAt: new Date('2026-10-30T17:00:00') })],
    });
    const board = await getKanbanBoard(client, {}, { now: NOW });

    expect(board.cards.find((item) => item.kind === 'transfer')).toMatchObject({
      column: 'DISCREPANCY',
      note: 'расхождение',
      noteTone: 'rose',
    });
  });

  it('отменённое перемещение — «Отменено»', async () => {
    const { client } = fakeClient({
      transfers: [transfer({ status: 'CANCELLED', updatedAt: new Date('2026-10-30T18:00:00') })],
    });
    const board = await getKanbanBoard(client, {}, { now: NOW });

    expect(board.cards.find((item) => item.kind === 'transfer')).toMatchObject({
      column: 'CANCELLED',
      note: 'перемещение отменено',
      cancelledBy: 'transfer',
    });
  });

  it('перемещение вне окна смены не показывается', async () => {
    const { client } = fakeClient({
      transfers: [transfer({ status: 'DRAFT', createdAt: new Date('2026-10-29T09:00:00') })],
    });
    const board = await getKanbanBoard(client, {}, { now: NOW });

    expect(board.cards.filter((item) => item.kind === 'transfer')).toHaveLength(0);
  });

  it('фильтр по складу действует только на перемещения', async () => {
    const { client } = fakeClient({
      lines: [gpLine()],
      transfers: [
        transfer({
          sourceWarehouse: { id: 'wh-prod', name: 'Производственный склад' },
          destinationWarehouse: { id: 'wh-other', name: 'Другой склад' },
        }),
      ],
    });
    const board = await getKanbanBoard(client, { warehouseId: 'wh-gp' }, { now: NOW });

    expect(board.cards.filter((item) => item.kind === 'transfer')).toHaveLength(0);
    expect(board.cards.filter((item) => item.kind === 'line')).toHaveLength(1);
  });

  it('подсказка про другие смены считается по перемещениям', async () => {
    const { client } = fakeClient({
      shifts: [DAY_SHIFT, SECOND_SHIFT],
      transfers: [
        transfer({
          createdAt: new Date('2026-10-31T09:00:00'),
          updatedAt: new Date('2026-10-31T09:00:00'),
        }),
      ],
    });

    const first = await getKanbanBoard(client, { shiftId: 'shift-1' }, { now: NOW });
    expect(first.cards.filter((item) => item.kind === 'transfer')).toHaveLength(0);
    expect(first.otherShiftsWithTransfers).toBe(1);

    const second = await getKanbanBoard(client, { shiftId: 'shift-2' }, { now: NOW });
    expect(second.cards.filter((item) => item.kind === 'transfer')).toHaveLength(1);
    expect(second.otherShiftsWithTransfers).toBe(0);
  });

  // Пункт 5 задания: перемещение видно в колонке той смены, когда его создали или отправили.
  it('создано в смену S — видно в S; после отправки в другую смену — в ней', async () => {
    const shifts = [DAY_SHIFT, SECOND_SHIFT];
    const createdBoard = await getKanbanBoard(
      fakeClient({ shifts, transfers: [transfer({ status: 'DRAFT' })] }).client,
      { shiftId: 'shift-1' },
      { now: NOW },
    );
    expect(createdBoard.cards.find((card) => card.kind === 'transfer')).toMatchObject({
      column: 'TRANSFER_DRAFT',
    });

    const submittedLater = transfer({
      status: 'SUBMITTED',
      createdAt: new Date('2026-10-30T09:00:00'),
      updatedAt: new Date('2026-10-31T12:00:00'),
      submittedAt: new Date('2026-10-31T12:00:00'),
    });

    const inFirstShift = await getKanbanBoard(
      fakeClient({ shifts, transfers: [submittedLater] }).client,
      { shiftId: 'shift-1' },
      { now: NOW },
    );
    expect(inFirstShift.cards.filter((card) => card.kind === 'transfer')).toHaveLength(0);

    const inSecondShift = await getKanbanBoard(
      fakeClient({ shifts, transfers: [submittedLater] }).client,
      { shiftId: 'shift-2' },
      { now: NOW },
    );
    expect(inSecondShift.cards.find((card) => card.kind === 'transfer')).toMatchObject({
      column: 'TRANSFER_SUBMITTED',
    });
  });
});

describe('доска: количество на карточке перемещения (ОПЭ-75)', () => {
  function line(planned: string, actual: string | null, difference?: string) {
    return {
      product: { code: 'GP002', name: 'Готовая продукция Б', unit: 'шт' },
      plannedQuantity: { toString: () => planned },
      actualQuantity: actual === null ? null : { toString: () => actual },
      discrepancies:
        difference === undefined
          ? []
          : [
              {
                actualQuantity: { toString: () => actual ?? planned },
                difference: { toString: () => difference },
              },
            ],
    };
  }

  it('приёмка с расхождением 40 → 37: карточка показывает 37 и план 40, а не 40', async () => {
    const { client } = fakeClient({
      transfers: [
        transfer({
          status: 'DISCREPANCY',
          updatedAt: new Date('2026-10-30T17:00:00'),
          lines: [line('40', '37', '-3')],
        }),
      ],
    });

    const board = await getKanbanBoard(client, {}, { now: NOW });
    const card = board.cards.find((item) => item.kind === 'transfer');

    expect(card).toMatchObject({
      column: 'DISCREPANCY',
      quantity: 37,
      plannedQuantity: 40,
      difference: -3,
    });
  });

  it('после согласования показывается согласованное количество', async () => {
    const { client } = fakeClient({
      transfers: [
        transfer({
          status: 'RECONCILED',
          updatedAt: new Date('2026-10-30T18:00:00'),
          lines: [line('40', '38', '-2')],
        }),
      ],
    });

    const board = await getKanbanBoard(client, {}, { now: NOW });
    expect(board.cards.find((item) => item.kind === 'transfer')).toMatchObject({
      quantity: 38,
      plannedQuantity: 40,
      difference: -2,
    });
  });

  it('приёмка без расхождения: принято равно плану, разницы нет', async () => {
    const { client } = fakeClient({
      transfers: [
        transfer({
          status: 'RECEIVED',
          updatedAt: new Date('2026-10-30T15:00:00'),
          lines: [line('40', '40')],
        }),
      ],
    });

    const board = await getKanbanBoard(client, {}, { now: NOW });
    expect(board.cards.find((item) => item.kind === 'transfer')).toMatchObject({
      quantity: 40,
      plannedQuantity: 40,
      difference: 0,
    });
  });

  it('черновик и отправленное показывают план: приёмки ещё не было', async () => {
    const draft = await getKanbanBoard(
      fakeClient({ transfers: [transfer({ status: 'DRAFT', lines: [line('40', null)] })] }).client,
      {},
      { now: NOW },
    );
    expect(draft.cards.find((item) => item.kind === 'transfer')).toMatchObject({
      quantity: 40,
      plannedQuantity: 40,
      difference: null,
    });

    const submitted = await getKanbanBoard(
      fakeClient({
        transfers: [
          transfer({
            status: 'SUBMITTED',
            submittedAt: new Date('2026-10-30T12:00:00'),
            lines: [line('40', null)],
          }),
        ],
      }).client,
      {},
      { now: NOW },
    );
    expect(submitted.cards.find((item) => item.kind === 'transfer')).toMatchObject({
      quantity: 40,
      difference: null,
    });
  });
});

describe('опции фильтров — из карточек доски (замечание владельца 01.11.2026)', () => {
  it('в списке номенклатуры только то, что есть в карточках за смену', async () => {
    const { client } = fakeClient({
      lines: [
        gpLine({ id: 'line-1', productId: 'gp-1', product: { code: 'GP001', name: 'Продукт А', unit: 'шт' } }),
        gpLine({ id: 'line-2', productId: 'gp-2', product: { code: 'GP002', name: 'Продукт Б', unit: 'шт' } }),
      ],
    });

    const board = await getKanbanBoard(client, {}, { now: NOW });

    expect(board.options.products.map((option) => option.label)).toEqual([
      'GP001 — Продукт А',
      'GP002 — Продукт Б',
    ]);
  });

  it('номенклатура из перемещений тоже попадает в список', async () => {
    const { client } = fakeClient({
      transfers: [
        transfer({
          lines: [
            {
              product: { id: 'gp-9', code: 'GP009', name: 'Продукт Я', unit: 'шт' },
              plannedQuantity: { toString: () => '5' },
              actualQuantity: null,
              discrepancies: [],
            },
          ],
        }),
      ],
    });

    const board = await getKanbanBoard(client, {}, { now: NOW });
    expect(board.options.products).toEqual([{ id: 'gp-9', label: 'GP009 — Продукт Я' }]);
  });

  // Главная тонкость: свой фильтр из расчёта своего списка исключается.
  it('при выбранной номенклатуре список не схлопывается до одной позиции', async () => {
    const { client } = fakeClient({
      lines: [
        gpLine({ id: 'line-1', productId: 'gp-1', product: { code: 'GP001', name: 'Продукт А', unit: 'шт' } }),
        gpLine({ id: 'line-2', productId: 'gp-2', product: { code: 'GP002', name: 'Продукт Б', unit: 'шт' } }),
      ],
    });

    const board = await getKanbanBoard(client, { productId: 'gp-1' }, { now: NOW });

    // На доске — одна позиция…
    expect(board.cards).toHaveLength(1);
    // …а в списке остаются обе: иначе сменить фильтр было бы нельзя.
    expect(board.options.products.map((option) => option.id)).toEqual(['gp-1', 'gp-2']);
  });

  it('фильтр по РЦ не схлопывает свой список, но сужает список номенклатуры', async () => {
    const { client } = fakeClient({
      lines: [
        gpLine({ id: 'line-1', workCenterId: 'wc-1', workCenter: { code: '01', name: 'РЦ-1' }, productId: 'gp-1', product: { code: 'GP001', name: 'А', unit: 'шт' } }),
        gpLine({ id: 'line-2', workCenterId: 'wc-2', workCenter: { code: '02', name: 'РЦ-2' }, productId: 'gp-2', product: { code: 'GP002', name: 'Б', unit: 'шт' } }),
      ],
    });

    const board = await getKanbanBoard(client, { workCenterId: 'wc-1' }, { now: NOW });

    expect(board.options.workCenters.map((option) => option.id)).toEqual(['wc-1', 'wc-2']);
    expect(board.options.products.map((option) => option.id)).toEqual(['gp-1']);
  });

  it('склад в списке — только из карточек перемещений', async () => {
    const { client } = fakeClient({
      lines: [gpLine()],
      transfers: [transfer()],
    });

    const board = await getKanbanBoard(client, {}, { now: NOW });
    expect(board.options.warehouses.map((option) => option.label).sort()).toEqual([
      'Производственный склад',
      'Склад ГП',
    ]);
  });

  it('выбранное значение, которого на доске нет, помечается, а не подменяется', async () => {
    const { client } = fakeClient({ lines: [gpLine({ productId: 'gp-1' })] });

    const board = await getKanbanBoard(client, { productId: 'gp-404' }, { now: NOW });

    expect(board.cards).toHaveLength(0);
    expect(board.options.missingSelection.product).toBe(true);
    // Значение остаётся в списке — экран покажет его как выбранное.
    expect(board.options.products.map((option) => option.id)).toEqual(['gp-1']);
  });

  it('пустая доска — пустые списки и никаких ложных пометок', async () => {
    const { client } = fakeClient({ lines: [], transfers: [] });
    const board = await getKanbanBoard(client, {}, { now: NOW });

    expect(board.options).toEqual({
      products: [],
      workCenters: [],
      warehouses: [],
      missingSelection: { product: false, workCenter: false, warehouse: false },
    });
  });
});

describe('доска: права ролей', () => {
  it('складские роли не видят колонок ПЗ, но видят перемещения', async () => {
    // Расхождение стоит между отправкой и приёмкой (решение владельца 31.10.2026).
    expect(visibleKanbanColumns(['KSGP']).map((column) => column.key)).toEqual([
      'TRANSFER_DRAFT',
      'TRANSFER_SUBMITTED',
      'DISCREPANCY',
      'RECEIVED',
      'CANCELLED',
    ]);

    const { client } = fakeClient({
      lines: [gpLine()],
      transfers: [transfer({ status: 'RECEIVED', updatedAt: new Date('2026-10-30T15:00:00') })],
    });
    const board = await getKanbanBoard(client, {}, { now: NOW });

    const forKsGP = filterKanbanCardsForRoles(board.cards, ['KSGP']);
    expect(forKsGP).toHaveLength(1);
    expect(forKsGP[0]).toMatchObject({ kind: 'transfer', column: 'RECEIVED' });
    expect(filterKanbanCardsForRoles(board.cards, ['USGP'])).toHaveLength(1);
    expect(filterKanbanCardsForRoles(board.cards, ['NP'])).toHaveLength(2);
  });

  it('отменённое ПЗ складской роли не показывается, отменённое перемещение — показывается', () => {
    const cards = [
      { kind: 'line', column: 'CANCELLED', cancelledBy: 'order' },
      { kind: 'transfer', column: 'CANCELLED', cancelledBy: 'transfer' },
    ] as KanbanCard[];

    expect(filterKanbanCardsForRoles(cards, ['KSGP']).map((card) => card.kind)).toEqual([
      'transfer',
    ]);
    expect(filterKanbanCardsForRoles(cards, ['OTK'])).toHaveLength(2);
  });
});
