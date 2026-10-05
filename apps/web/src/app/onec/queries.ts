import type { Prisma, TaskForOneCStatus, TaskForOneCType } from '@prisma/client';
import { prisma } from '@prodtrack/db';
import { requireAnyPermission } from '@/lib/auth/access';
import { parsePageParam, toPageResult, type PageResult } from '@/lib/pagination';
import { parseTaskData, type OneCTaskData } from '@/lib/onec/task-data';

/**
 * Чтение рабочего места С1С (T-051, M12 §8, BR-7/BR-9).
 *
 * Доступ: право \`onec:read\` (00 §4.2 — С1С и АДМ). Фильтры и пагинация серверные:
 * клиентская фильтрация списка не используется (T-057/T-058).
 */

export const ONE_C_PAGE_SIZE = 50;

export const ONE_C_TYPES = ['PRODUCTION', 'TRANSFER'] as const;
/**
 * Статусы задачи по M12 §4.2: «Ожидает → Обработано». Значение \`CANCELLED\` есть в схеме,
 * но статусной моделью M12 не используется — в фильтр списка не выводится.
 */
export const ONE_C_STATUSES = ['PENDING', 'PROCESSED'] as const;

export type OneCTypeFilter = 'ALL' | (typeof ONE_C_TYPES)[number];
export type OneCStatusFilter = 'ALL' | (typeof ONE_C_STATUSES)[number];

export interface OneCTaskFilter {
  type?: OneCTypeFilter;
  status?: OneCStatusFilter;
}

/** Разбирает фильтр типа из строки запроса: неизвестное значение → «все». */
export function parseOneCTypeFilter(value: string | undefined): OneCTypeFilter {
  return ONE_C_TYPES.includes(value as (typeof ONE_C_TYPES)[number])
    ? (value as OneCTypeFilter)
    : 'ALL';
}

/** Разбирает фильтр статуса из строки запроса: неизвестное значение → «все». */
export function parseOneCStatusFilter(value: string | undefined): OneCStatusFilter {
  return ONE_C_STATUSES.includes(value as (typeof ONE_C_STATUSES)[number])
    ? (value as OneCStatusFilter)
    : 'ALL';
}

/** Условие выборки списка задач. */
export function oneCWhere(filter: OneCTaskFilter): Prisma.TaskForOneCWhereInput {
  const where: Prisma.TaskForOneCWhereInput = {};
  if (filter.type && filter.type !== 'ALL') {
    where.type = filter.type;
  }
  if (filter.status && filter.status !== 'ALL') {
    where.status = filter.status;
  }
  return where;
}

/** Задача в том виде, в каком её отдаёт список: реквизиты источника разобраны из JSON. */
export interface OneCTaskRow {
  id: string;
  type: TaskForOneCType;
  sourceId: string;
  sourceType: string;
  status: TaskForOneCStatus;
  processedAt: Date | null;
  processedById: string | null;
  lastChangedAt: Date;
  createdAt: Date;
  data: OneCTaskData | null;
}

interface TaskRecord {
  id: string;
  type: TaskForOneCType;
  sourceId: string;
  sourceType: string;
  status: TaskForOneCStatus;
  data: Prisma.JsonValue;
  processedAt: Date | null;
  processedById: string | null;
  lastChangedAt: Date;
  createdAt: Date;
}

function toRow(record: TaskRecord): OneCTaskRow {
  return {
    id: record.id,
    type: record.type,
    sourceId: record.sourceId,
    sourceType: record.sourceType,
    status: record.status,
    processedAt: record.processedAt,
    processedById: record.processedById,
    lastChangedAt: record.lastChangedAt,
    createdAt: record.createdAt,
    data: parseTaskData(record.data),
  };
}

/**
 * Страница задач: сначала необработанные, затем по времени последнего изменения (Р-18).
 * Отдельный \`count\` не выполняется — наличие следующей страницы определяется по лишней записи.
 */
export async function getOneCTasksPage(
  filter: OneCTaskFilter,
  pageParam?: string,
): Promise<PageResult<OneCTaskRow>> {
  await requireAnyPermission(['onec:read']);

  const params = parsePageParam(pageParam, ONE_C_PAGE_SIZE);

  const records = await prisma.taskForOneC.findMany({
    where: oneCWhere(filter),
    orderBy: [{ status: 'asc' }, { lastChangedAt: 'desc' }],
    skip: params.skip,
    take: params.take,
  });

  return toPageResult(records.map(toRow), params);
}

export interface OneCTaskDetail {
  task: OneCTaskRow;
  /** Логин С1С, поставившего отметку «обработано» (BR-4). */
  processedByLogin: string | null;
}

/** Карточка задачи: реквизиты для копирования в 1С (UC-M12-2). */
export async function getOneCTaskById(id: string): Promise<OneCTaskDetail | null> {
  await requireAnyPermission(['onec:read']);

  const record = await prisma.taskForOneC.findUnique({ where: { id } });
  if (!record) return null;

  const task = toRow(record);
  const processedBy = task.processedById
    ? await prisma.user.findUnique({
        where: { id: task.processedById },
        select: { login: true },
      })
    : null;

  return { task, processedByLogin: processedBy?.login ?? null };
}
