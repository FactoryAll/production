import { describe, it, expect } from 'vitest';
import { dedupeConsecutiveTransitions, type TimingRecordItem } from '../queries';

function record(partial: Partial<TimingRecordItem>): TimingRecordItem {
  return {
    id: 't-1',
    documentType: 'PRODUCTION_ORDER',
    documentId: 'po-1',
    entityType: 'DOCUMENT',
    entityId: 'po-1',
    fromStatus: 'IN_PROGRESS',
    toStatus: 'COMPLETED',
    transitionedAt: '2026-10-05T07:47:46.000Z',
    initiatorRole: null,
    initiatorId: null,
    ...partial,
  };
}

describe('dedupeConsecutiveTransitions (дубль из дефекта №7)', () => {
  it('схлопывает два одинаковых перехода в один, оставляя запись с инициатором', () => {
    const result = dedupeConsecutiveTransitions([
      record({ id: 'dup', initiatorId: null, initiatorRole: null }),
      record({ id: 'real', initiatorId: 'user-1', initiatorRole: 'NP', transitionedAt: '2026-10-05T07:47:46.200Z' }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('real');
  });

  it('не склеивает разные переходы даже в одну секунду', () => {
    const result = dedupeConsecutiveTransitions([
      record({ id: 'a', fromStatus: 'CONFIRMED', toStatus: 'IN_PROGRESS' }),
      record({ id: 'b', fromStatus: 'IN_PROGRESS', toStatus: 'COMPLETED' }),
    ]);

    expect(result).toHaveLength(2);
  });

  it('не склеивает одинаковые переходы, разнесённые по времени', () => {
    const result = dedupeConsecutiveTransitions([
      record({ id: 'a', transitionedAt: '2026-10-05T07:47:46.000Z' }),
      record({ id: 'b', transitionedAt: '2026-10-05T09:00:00.000Z' }),
    ]);

    expect(result).toHaveLength(2);
  });
});
