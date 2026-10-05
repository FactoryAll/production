import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@prodtrack/db';
import { getTimingPage, getTimingRecords } from '../queries';

vi.mock('@prodtrack/db', () => ({
  prisma: { stageTiming: { findMany: vi.fn() } },
}));

function record(id: string, fromStatus: string, toStatus: string) {
  return {
    id,
    documentType: 'PRODUCTION_ORDER',
    documentId: 'po-1',
    entityType: 'LINE',
    entityId: 'line-1',
    fromStatus,
    toStatus,
    transitionedAt: new Date('2026-08-25T16:15:13Z'),
    initiatorRole: 'OPR',
    initiatorId: 'user-1',
  };
}

describe('список переходов не содержит записей без смены статуса (дефект №9)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.stageTiming.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      record('real', 'ACCEPTED', 'REPORTED'),
      record('phantom', 'REPORTED', 'REPORTED'),
    ]);
  });

  it('getTimingRecords скрывает «переходы» вида REPORTED → REPORTED', async () => {
    const items = await getTimingRecords({});

    expect(items.map((item) => item.id)).toEqual(['real']);
  });

  it('getTimingPage скрывает такие записи', async () => {
    const result = await getTimingPage({});

    expect(result.items.map((item) => item.id)).toEqual(['real']);
  });
});
