import { describe, it, expect, vi } from 'vitest';
import { archiveOldAuditRecords, AUDIT_RETENTION_MONTHS, auditArchiveCutoff } from './audit-archive';

describe('auditArchiveCutoff (Р-09, BR-5: срок хранения 12 месяцев)', () => {
  it('отодвигает границу ровно на 12 месяцев', () => {
    const cutoff = auditArchiveCutoff(new Date('2026-10-03T10:00:00.000Z'));
    expect(cutoff.toISOString()).toBe('2025-10-03T10:00:00.000Z');
    expect(AUDIT_RETENTION_MONTHS).toBe(12);
  });

  it('поддерживает настраиваемый срок', () => {
    const cutoff = auditArchiveCutoff(new Date('2026-10-03T10:00:00.000Z'), 1);
    expect(cutoff.toISOString()).toBe('2026-09-03T10:00:00.000Z');
  });
});

describe('archiveOldAuditRecords (T-049, Р-16)', () => {
  it('архивирует только старые неархивные записи', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 3 });
    const client = { auditRecord: { updateMany } };

    const archived = await archiveOldAuditRecords(client, {
      now: new Date('2026-10-03T10:00:00.000Z'),
    });

    expect(archived).toBe(3);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        archived: false,
        createdAt: { lt: new Date('2025-10-03T10:00:00.000Z') },
      },
      data: { archived: true },
    });
  });

  it('идемпотентна: записи не удаляются, а только помечаются', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const client = { auditRecord: { updateMany } };

    const archived = await archiveOldAuditRecords(client, {
      now: new Date('2026-10-03T10:00:00.000Z'),
    });

    expect(archived).toBe(0);
    const call = updateMany.mock.calls[0][0];
    expect(call.data).toEqual({ archived: true });
    expect(call.where.archived).toBe(false);
  });
});
