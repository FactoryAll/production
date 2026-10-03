import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@prodtrack/db';
import {
  buildStageDurations,
  getTimingRecords,
  TERMINAL_STATUSES,
  TIMING_PAGE_SIZE,
  timingWhere,
  type TimingRecordItem,
} from '../queries';

vi.mock('@prodtrack/db', () => ({
  prisma: {
    stageTiming: { findMany: vi.fn() },
    productionOrderLine: { findMany: vi.fn() },
  },
}));

function record(partial: Partial<TimingRecordItem>): TimingRecordItem {
  return {
    id: 't-1',
    documentType: 'PRODUCTION_ORDER',
    documentId: 'po-1',
    entityType: 'DOCUMENT',
    entityId: 'po-1',
    fromStatus: 'DRAFT',
    toStatus: 'CONFIRMED',
    transitionedAt: '2026-10-03T10:00:00.000Z',
    initiatorRole: 'NP',
    initiatorId: 'user-1',
    ...partial,
  };
}

describe('timingWhere (фильтр по документу и типу, M10 §8)', () => {
  it('без фильтров не накладывает условий', () => {
    expect(timingWhere({})).toEqual({});
  });

  it('фильтрует по типу документа', () => {
    expect(timingWhere({ documentType: 'GOODS_TRANSFER' })).toEqual({
      documentType: 'GOODS_TRANSFER',
    });
  });

  it('фильтрует по фрагменту идентификатора документа', () => {
    expect(timingWhere({ documentId: 'po-1' })).toEqual({
      documentId: { contains: 'po-1' },
    });
  });

  it('ограничение области видимости (ОПР) имеет приоритет над фрагментом', () => {
    expect(timingWhere({ documentId: 'po-1', documentIds: ['po-1', 'po-2'] })).toEqual({
      documentId: { in: ['po-1', 'po-2'] },
    });
  });
});

describe('buildStageDurations (UC-M10-2)', () => {
  it('возвращает пустой список без записей', () => {
    expect(buildStageDurations([])).toEqual([]);
  });

  it('считает длительности этапов ПЗ до COMPLETED', () => {
    const stages = buildStageDurations([
      record({ id: 't-1', fromStatus: 'DRAFT', toStatus: 'CONFIRMED', transitionedAt: '2026-10-03T10:00:00.000Z' }),
      record({ id: 't-2', fromStatus: 'CONFIRMED', toStatus: 'IN_PROGRESS', transitionedAt: '2026-10-03T12:00:00.000Z' }),
      record({ id: 't-3', fromStatus: 'IN_PROGRESS', toStatus: 'COMPLETED', transitionedAt: '2026-10-03T15:00:00.000Z' }),
    ]);

    expect(stages).toEqual([
      {
        fromStatus: 'DRAFT',
        toStatus: 'CONFIRMED',
        startedAt: null,
        endedAt: '2026-10-03T10:00:00.000Z',
        durationMs: null,
        isCurrent: false,
      },
      {
        fromStatus: 'CONFIRMED',
        toStatus: 'IN_PROGRESS',
        startedAt: '2026-10-03T10:00:00.000Z',
        endedAt: '2026-10-03T12:00:00.000Z',
        durationMs: 2 * 60 * 60 * 1000,
        isCurrent: false,
      },
      {
        fromStatus: 'IN_PROGRESS',
        toStatus: 'COMPLETED',
        startedAt: '2026-10-03T12:00:00.000Z',
        endedAt: '2026-10-03T15:00:00.000Z',
        durationMs: 3 * 60 * 60 * 1000,
        isCurrent: false,
      },
    ]);
  });

  it('добавляет текущий этап, если документ не в терминальном статусе', () => {
    const stages = buildStageDurations(
      [record({ fromStatus: 'DRAFT', toStatus: 'SUBMITTED', transitionedAt: '2026-10-03T10:00:00.000Z', documentType: 'GOODS_TRANSFER' })],
      new Date('2026-10-03T12:30:00.000Z'),
    );

    expect(stages).toHaveLength(2);
    expect(stages[1]).toEqual({
      fromStatus: 'SUBMITTED',
      toStatus: null,
      startedAt: '2026-10-03T10:00:00.000Z',
      endedAt: null,
      durationMs: 2.5 * 60 * 60 * 1000,
      isCurrent: true,
    });
  });

  it('отмена (Р-12) закрывает цепочку этапов', () => {
    const stages = buildStageDurations(
      [
        record({ id: 't-1', fromStatus: 'DRAFT', toStatus: 'CONFIRMED', transitionedAt: '2026-10-03T10:00:00.000Z' }),
        record({ id: 't-2', fromStatus: 'CONFIRMED', toStatus: 'CANCELLED', transitionedAt: '2026-10-03T11:00:00.000Z' }),
      ],
      new Date('2026-10-03T20:00:00.000Z'),
    );

    expect(stages).toHaveLength(2);
    expect(stages[1].toStatus).toBe('CANCELLED');
    expect(stages.some((stage) => stage.isCurrent)).toBe(false);
  });

  it('учитывает ввод за Оператора: ASSIGNED → REPORTED (Р-11)', () => {
    const stages = buildStageDurations(
      [
        record({
          documentType: 'PRODUCTION_ORDER',
          entityType: 'LINE',
          entityId: 'line-1',
          fromStatus: 'ASSIGNED',
          toStatus: 'REPORTED',
          initiatorRole: 'NP',
        }),
      ],
      new Date('2026-10-03T10:30:00.000Z'),
    );

    expect(stages).toHaveLength(1);
    expect(stages[0]).toMatchObject({ fromStatus: 'ASSIGNED', toStatus: 'REPORTED', isCurrent: false });
  });

  it('сортирует записи по времени, даже если они пришли не по порядку', () => {
    const stages = buildStageDurations([
      record({ id: 't-2', fromStatus: 'CONFIRMED', toStatus: 'IN_PROGRESS', transitionedAt: '2026-10-03T12:00:00.000Z' }),
      record({ id: 't-1', fromStatus: 'DRAFT', toStatus: 'CONFIRMED', transitionedAt: '2026-10-03T10:00:00.000Z' }),
    ]);

    expect(stages.map((stage) => stage.fromStatus)).toEqual([
      'DRAFT',
      'CONFIRMED',
      'IN_PROGRESS',
    ]);
    expect(stages[1].durationMs).toBe(2 * 60 * 60 * 1000);
    // Документ остался в IN_PROGRESS — этап продолжается.
    expect(stages[2].isCurrent).toBe(true);
  });

  it('перечень терминальных статусов покрывает ПЗ и Перемещение (00 §3)', () => {
    expect(TERMINAL_STATUSES.PRODUCTION_ORDER).toEqual(['COMPLETED', 'CANCELLED']);
    expect(TERMINAL_STATUSES.GOODS_TRANSFER).toEqual(['RECEIVED', 'RECONCILED', 'CANCELLED']);
  });
});

describe('getTimingRecords', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('читает записи с фильтром, сортировкой по времени и ограничением выборки', async () => {
    (prisma.stageTiming.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 't-1',
        documentType: 'GOODS_TRANSFER',
        documentId: 'tr-1',
        entityType: 'DOCUMENT',
        entityId: 'tr-1',
        fromStatus: 'DRAFT',
        toStatus: 'SUBMITTED',
        transitionedAt: new Date('2026-10-03T10:00:00.000Z'),
        initiatorRole: 'NP',
        initiatorId: 'user-1',
      },
    ]);

    const records = await getTimingRecords({ documentType: 'GOODS_TRANSFER' });

    expect(prisma.stageTiming.findMany).toHaveBeenCalledWith({
      where: { documentType: 'GOODS_TRANSFER' },
      orderBy: [{ transitionedAt: 'desc' }],
      take: TIMING_PAGE_SIZE,
    });
    expect(records[0]).toMatchObject({
      id: 't-1',
      transitionedAt: '2026-10-03T10:00:00.000Z',
      fromStatus: 'DRAFT',
      toStatus: 'SUBMITTED',
    });
  });
});
