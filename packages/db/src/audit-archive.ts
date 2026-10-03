// Архивация аудита M13 / Р-16 (T-049).
//
// Записи старше 12 месяцев не удаляются, а помечаются `archived = true`
// (M13 §4.2, BR-6). Операция идемпотентна: повторный запуск не меняет
// уже архивные записи.

import type { PrismaClient } from '@prisma/client';

/** Срок хранения аудита — 12 месяцев (Р-09, BR-5). */
export const AUDIT_RETENTION_MONTHS = 12;

type AuditRecordClient = Pick<PrismaClient, 'auditRecord'>;

/** Граница архивации: записи, созданные раньше этой даты, уходят в архив. */
export function auditArchiveCutoff(
  now: Date = new Date(),
  months: number = AUDIT_RETENTION_MONTHS,
): Date {
  const cutoff = new Date(now.getTime());
  cutoff.setMonth(cutoff.getMonth() - months);
  return cutoff;
}

/**
 * Архивирует аудит-записи старше срока хранения.
 * Возвращает количество записей, переведённых в архив.
 */
export async function archiveOldAuditRecords(
  client: AuditRecordClient,
  options: { now?: Date; months?: number } = {},
): Promise<number> {
  const cutoff = auditArchiveCutoff(
    options.now ?? new Date(),
    options.months ?? AUDIT_RETENTION_MONTHS,
  );

  const result = await client.auditRecord.updateMany({
    where: { archived: false, createdAt: { lt: cutoff } },
    data: { archived: true },
  });

  return result.count;
}
