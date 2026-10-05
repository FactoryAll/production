import { describe, it, expect } from 'vitest';
import { buildStageDurationGroups, type TimingRecordItem } from '../queries';

function record(partial: Partial<TimingRecordItem>): TimingRecordItem {
  return {
    id: 't-1',
    documentType: 'PRODUCTION_ORDER',
    documentId: 'po-1',
    entityType: 'DOCUMENT',
    entityId: 'po-1',
    fromStatus: 'DRAFT',
    toStatus: 'CONFIRMED',
    transitionedAt: '2026-10-04T14:25:13.000Z',
    initiatorRole: 'NP',
    initiatorId: 'user-1',
    ...partial,
  };
}

describe('buildStageDurationGroups (дефект №7: документ и строки РЦ раздельно)', () => {
  it('разделяет переходы документа и строк, документ идёт первым', () => {
    const groups = buildStageDurationGroups([
      record({ id: 'l-1', entityType: 'LINE', entityId: 'line-1', fromStatus: 'ASSIGNED', toStatus: 'ACCEPTED', transitionedAt: '2026-10-04T15:00:00.000Z' }),
      record({ id: 'd-1', entityType: 'DOCUMENT', entityId: 'po-1', fromStatus: 'DRAFT', toStatus: 'CONFIRMED', transitionedAt: '2026-10-04T14:25:13.000Z' }),
      record({ id: 'd-2', entityType: 'DOCUMENT', entityId: 'po-1', fromStatus: 'CONFIRMED', toStatus: 'IN_PROGRESS', transitionedAt: '2026-10-04T16:31:10.000Z' }),
    ], new Date('2026-10-04T17:00:00.000Z'));

    expect(groups).toHaveLength(2);
    expect(groups[0].entityType).toBe('DOCUMENT');
    // Документ незавершён, поэтому к цепочке добавляется текущий этап (IN_PROGRESS → …).
    expect(groups[0].stages.map((stage) => stage.fromStatus)).toEqual([
      'DRAFT',
      'CONFIRMED',
      'IN_PROGRESS',
    ]);
    expect(groups[0].stages[2].isCurrent).toBe(true);
    expect(groups[1].entityType).toBe('LINE');
    expect(groups[1].stages).toHaveLength(1);
    // У строки РЦ текущего этапа быть не должно — её статус конечен.
    expect(groups[1].stages.some((stage) => stage.isCurrent)).toBe(false);
  });

  it('возвращает пустой список без записей', () => {
    expect(buildStageDurationGroups([])).toEqual([]);
  });
});
