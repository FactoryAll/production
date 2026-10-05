// Read-side хронометража M10 (T-046) поверх kernel-записей `StageTiming` (T-059).
//
// Записи создаются бизнес-логикой модулей; здесь только чтение, фильтры и
// расчёт длительностей этапов (UC-M10-2).

import { prisma } from '@prodtrack/db';
import type { DocumentType, EntityType, Prisma } from '@prisma/client';
import { parsePageParam, toPageResult, type PageResult } from '@/lib/pagination';

export interface TimingRecordItem {
  id: string;
  documentType: DocumentType;
  documentId: string;
  entityType: EntityType;
  entityId: string;
  fromStatus: string;
  toStatus: string;
  transitionedAt: string;
  initiatorRole: string | null;
  initiatorId: string | null;
}

export interface TimingFilter {
  documentType?: DocumentType;
  /** Фрагмент идентификатора документа (фильтр «по документу», M10 §8). */
  documentId?: string;
  /** Ограничение видимости набором документов (ОПР — свой РЦ, M10 §3). */
  documentIds?: string[];
  limit?: number;
}

/** Терминальные статусы документов (00 §3): после них текущий этап не открывается. */
export const TERMINAL_STATUSES: Record<string, string[]> = {
  PRODUCTION_ORDER: ['COMPLETED', 'CANCELLED'],
  GOODS_TRANSFER: ['RECEIVED', 'RECONCILED', 'CANCELLED'],
};

export interface StageDuration {
  fromStatus: string;
  toStatus: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  /** true — этап ещё продолжается (документ в этом статусе). */
  isCurrent: boolean;
}

/** Размер страницы списка записей хронометража (T-057). */
export const TIMING_PAGE_SIZE = 50;

/** Условие выборки хронометража. Типизировано Prisma-типом: имена полей проверяет компилятор. */
export function timingWhere(filter: TimingFilter): Prisma.StageTimingWhereInput {
  const where: Prisma.StageTimingWhereInput = {};
  if (filter.documentType) {
    where.documentType = filter.documentType;
  }
  if (filter.documentIds) {
    where.documentId = { in: filter.documentIds };
  } else if (filter.documentId) {
    where.documentId = { contains: filter.documentId };
  }
  return where;
}

/**
 * Длительности этапов по документу (UC-M10-2).
 * Каждый переход закрывает предыдущий этап; незавершённый этап считается до `now`.
 *
 * Функция рассчитана на записи одной сущности: смешивать переходы документа
 * и строк РЦ нельзя — получается бессмысленная цепочка (дефект №7 v1.2.0).
 */
export function buildStageDurations(
  records: TimingRecordItem[],
  now: Date = new Date(),
): StageDuration[] {
  if (records.length === 0) {
    return [];
  }

  const sorted = dedupeConsecutiveTransitions(
    [...records]
      // Записи, не меняющие статус, этапом не являются (исторические следы
      // корректировок факта, Р-18) — в цепочке длительностей их не учитываем.
      .filter((record) => record.fromStatus !== record.toStatus)
      .sort(
        (a, b) => new Date(a.transitionedAt).getTime() - new Date(b.transitionedAt).getTime(),
      ),
  );

  const stages: StageDuration[] = [
    {
      fromStatus: sorted[0].fromStatus,
      toStatus: sorted[0].toStatus,
      startedAt: null,
      endedAt: sorted[0].transitionedAt,
      durationMs: null,
      isCurrent: false,
    },
  ];

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    stages.push({
      fromStatus: previous.toStatus,
      toStatus: current.toStatus,
      startedAt: previous.transitionedAt,
      endedAt: current.transitionedAt,
      durationMs:
        new Date(current.transitionedAt).getTime() - new Date(previous.transitionedAt).getTime(),
      isCurrent: false,
    });
  }

  const last = sorted[sorted.length - 1];
  const terminal = TERMINAL_STATUSES[last.documentType] ?? [];
  // Текущий этап открывается только у документа: статус строки ПЗ (REPORTED)
  // конечен, для строки «текущего этапа» не существует (M10 §4/§6).
  if (last.entityType === 'DOCUMENT' && !terminal.includes(last.toStatus)) {
    stages.push({
      fromStatus: last.toStatus,
      toStatus: null,
      startedAt: last.transitionedAt,
      endedAt: null,
      durationMs: Math.max(0, now.getTime() - new Date(last.transitionedAt).getTime()),
      isCurrent: true,
    });
  }

  return stages;
}

export interface StageDurationGroup {
  entityType: EntityType;
  entityId: string;
  stages: StageDuration[];
}

/**
 * Схлопывает повторные записи об одном и том же переходе.
 *
 * Дефект №7 v1.2.0 писал переход ПЗ `IN_PROGRESS → COMPLETED` дважды (вторая запись —
 * без инициатора). Такие дубли уже лежат в базе, поэтому расчёт длительностей должен
 * быть устойчив к ним: из пары одинаковых записей оставляем ту, где есть инициатор.
 */
export function dedupeConsecutiveTransitions(
  sortedRecords: TimingRecordItem[],
): TimingRecordItem[] {
  const result: TimingRecordItem[] = [];

  for (const record of sortedRecords) {
    const previous = result[result.length - 1];
    const isDuplicate =
      previous !== undefined &&
      previous.fromStatus === record.fromStatus &&
      previous.toStatus === record.toStatus &&
      Math.abs(
        new Date(record.transitionedAt).getTime() -
          new Date(previous.transitionedAt).getTime(),
      ) < 1000;

    if (!isDuplicate) {
      result.push(record);
      continue;
    }

    if (!previous.initiatorId && record.initiatorId) {
      result[result.length - 1] = record;
    }
  }

  return result;
}

/**
 * Длительности этапов, сгруппированные по сущности: отдельно документ и отдельно строки РЦ.
 * Документ идёт первым.
 */
export function buildStageDurationGroups(
  records: TimingRecordItem[],
  now: Date = new Date(),
): StageDurationGroup[] {
  const grouped = new Map<string, TimingRecordItem[]>();

  for (const record of records) {
    const key = record.entityType + ':' + record.entityId;
    const list = grouped.get(key);
    if (list) {
      list.push(record);
    } else {
      grouped.set(key, [record]);
    }
  }

  return [...grouped.values()]
    .map((groupRecords) => ({
      entityType: groupRecords[0].entityType,
      entityId: groupRecords[0].entityId,
      stages: buildStageDurations(groupRecords, now),
    }))
    .sort((left, right) => {
      if (left.entityType === right.entityType) {
        return left.entityId.localeCompare(right.entityId);
      }
      return left.entityType === 'DOCUMENT' ? -1 : 1;
    });
}

function toItem(record: {
  id: string;
  documentType: DocumentType;
  documentId: string;
  entityType: EntityType;
  entityId: string;
  fromStatus: string;
  toStatus: string;
  transitionedAt: Date;
  initiatorRole: string | null;
  initiatorId: string | null;
}): TimingRecordItem {
  return {
    id: record.id,
    documentType: record.documentType,
    documentId: record.documentId,
    entityType: record.entityType,
    entityId: record.entityId,
    fromStatus: record.fromStatus,
    toStatus: record.toStatus,
    transitionedAt: record.transitionedAt.toISOString(),
    initiatorRole: record.initiatorRole,
    initiatorId: record.initiatorId,
  };
}

export async function getTimingRecords(filter: TimingFilter = {}): Promise<TimingRecordItem[]> {
  const records = await prisma.stageTiming.findMany({
    where: timingWhere(filter),
    orderBy: [{ transitionedAt: 'desc' }],
    take: filter.limit ?? TIMING_PAGE_SIZE,
  });
  return records.map(toItem);
}

/**
 * Страница списка переходов (T-057): `skip`/`take` без отдельного `count` —
 * признак следующей страницы берётся из «лишней» записи.
 */
export async function getTimingPage(
  filter: TimingFilter,
  pageParam?: string,
): Promise<PageResult<TimingRecordItem>> {
  const params = parsePageParam(pageParam, TIMING_PAGE_SIZE);

  const records = await prisma.stageTiming.findMany({
    where: timingWhere(filter),
    orderBy: [{ transitionedAt: 'desc' }],
    skip: params.skip,
    take: params.take,
  });

  return toPageResult(records.map(toItem), params);
}

/** Записи одного документа в порядке времени — основа расчёта длительностей. */
export async function getDocumentTimingRecords(
  documentType: DocumentType,
  documentId: string,
): Promise<TimingRecordItem[]> {
  const records = await prisma.stageTiming.findMany({
    where: { documentType, documentId },
    orderBy: [{ transitionedAt: 'asc' }],
  });
  return records.map(toItem);
}

/** Документы (ПЗ), в которых у оператора есть строка своего РЦ — область видимости ОПР (M10 §3). */
export async function getOwnDocumentIds(employeeId: string): Promise<string[]> {
  const lines = await prisma.productionOrderLine.findMany({
    where: { operatorId: employeeId },
    select: { orderId: true },
  });
  return [...new Set(lines.map((line) => line.orderId))];
}
