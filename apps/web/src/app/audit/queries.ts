// Read-side аудита M13 (T-047) поверх kernel-записей `AuditRecord` (T-059).
//
// Аудит append-only: модуль только читает записи, изменять и удалять их нельзя
// (M13 BR-2). Архивные записи скрыты от всех, кроме АДМ (Р-16, BR-6).

import type { Prisma } from '@prisma/client';
import { prisma } from '@prodtrack/db';
import { parsePageParam, toPageResult, type PageResult } from '@/lib/pagination';

export interface AuditRecordItem {
  id: string;
  userId: string | null;
  userLogin: string | null;
  role: string | null;
  action: string;
  objectType: string;
  objectId: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
  archived: boolean;
}

export interface AuditFilter {
  /** Пользователь, чьи действия показываем (M13 §8). */
  userId?: string;
  objectType?: string;
  objectId?: string;
  /** Период: ISO-дата начала (включительно). */
  from?: string;
  /** Период: ISO-дата окончания (включительно, до конца дня). */
  to?: string;
  /** Флаг «показать архив» — учитывается только для АДМ (BR-6). */
  showArchived?: boolean;
  limit?: number;
}

/** Размер страницы списка аудита (T-057). */
export const AUDIT_PAGE_SIZE = 50;

/** Предел выборки истории одного объекта. */
export const AUDIT_HISTORY_LIMIT = 200;

/**
 * Условие выборки аудита.
 * `canShowArchived` — признак того, что пользователь вправе видеть архив (только АДМ, BR-6):
 * для остальных ролей архив скрыт, даже если флаг запрошен.
 */
/** Условие выборки аудита. Типизировано Prisma-типом: имена полей проверяет компилятор. */
export function auditWhere(
  filter: AuditFilter,
  canShowArchived: boolean,
): Prisma.AuditRecordWhereInput {
  const where: Prisma.AuditRecordWhereInput = {};

  // BR-6: архив скрыт из обычных выборок всех ролей, кроме АДМ.
  // Для остальных ролей флаг «показать архив» игнорируется.
  if (!(canShowArchived && filter.showArchived)) {
    where.archived = false;
  }

  if (filter.userId) {
    where.userId = filter.userId;
  }
  if (filter.objectType) {
    where.objectType = filter.objectType;
  }
  if (filter.objectId) {
    where.objectId = filter.objectId;
  }
  if (filter.from || filter.to) {
    where.createdAt = {
      ...(filter.from ? { gte: new Date(filter.from) } : {}),
      ...(filter.to ? { lte: new Date(filter.to + 'T23:59:59.999Z') } : {}),
    };
  }

  return where;
}

function toItem(record: {
  id: string;
  userId: string | null;
  role: string | null;
  action: string;
  objectType: string;
  objectId: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  createdAt: Date;
  archived: boolean;
  user?: { login: string } | null;
}): AuditRecordItem {
  return {
    id: record.id,
    userId: record.userId,
    userLogin: record.user?.login ?? null,
    role: record.role,
    action: record.action,
    objectType: record.objectType,
    objectId: record.objectId,
    field: record.field,
    oldValue: record.oldValue,
    newValue: record.newValue,
    createdAt: record.createdAt.toISOString(),
    archived: record.archived,
  };
}

export async function getAuditRecords(
  filter: AuditFilter,
  canShowArchived: boolean,
): Promise<AuditRecordItem[]> {
  const records = await prisma.auditRecord.findMany({
    where: auditWhere(filter, canShowArchived),
    orderBy: [{ createdAt: 'desc' }],
    include: { user: { select: { login: true } } },
    take: filter.limit ?? AUDIT_HISTORY_LIMIT,
  });
  return records.map(toItem);
}

/**
 * Страница журнала аудита (T-057): выборка с `skip`/`take` без отдельного `count`
 * — наличие следующей страницы определяется по «лишней» записи.
 */
export async function getAuditPage(
  filter: AuditFilter,
  canShowArchived: boolean,
  pageParam?: string,
): Promise<PageResult<AuditRecordItem>> {
  const params = parsePageParam(pageParam, AUDIT_PAGE_SIZE);

  const records = await prisma.auditRecord.findMany({
    where: auditWhere(filter, canShowArchived),
    orderBy: [{ createdAt: 'desc' }],
    include: { user: { select: { login: true } } },
    skip: params.skip,
    take: params.take,
  });

  return toPageResult(records.map(toItem), params);
}

/**
 * История изменений объекта — вкладка «История» в карточке объекта (M13 §8).
 * Архив недоступен: история объекта показывается без архивных записей, кроме АДМ.
 */
export async function getObjectHistory(
  objectType: string,
  objectId: string,
  canShowArchived: boolean,
): Promise<AuditRecordItem[]> {
  return getAuditRecords(
    { objectType, objectId, showArchived: canShowArchived },
    canShowArchived,
  );
}
