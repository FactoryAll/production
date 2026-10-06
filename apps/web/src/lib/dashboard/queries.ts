// Загрузчики дашборда M11 (Р-08).
//
// Модуль без 'use server': только чтение (урок Фазы 3). Каждая функция делает один-два
// запроса — агрегаты считает база, обращения к БД в цикле отсутствуют (DoD: нет N+1).
//
// Decimal из Prisma преобразуется в number до передачи в клиентский компонент: Decimal —
// не plain object, и React ругается на него при передаче из серверного компонента.

import type { DocumentType, GoodsTransferStatus, ProductionOrderStatus } from '@prisma/client';
import { prisma } from '@prodtrack/db';
import {
  GOODS_TRANSFER_STATUSES,
  PRODUCTION_ORDER_STATUSES,
  type DashboardDocumentFilter,
} from './document-filter';
import {
  buildStageDurationGroups,
  type TimingRecordItem,
} from '@/app/timing/queries';
import {
  documentAgeMs,
  summarizeStageDurations,
  type CategoryTotals,
  type StageDurationSummary,
} from './aggregates';
// Номер текущей смены и календарная дата берутся из общего модуля смен (T-075):
// смена — это дата и номер, а не строка справочника, которую ведут руками.
import { currentShiftNumber, localDateKey, shiftDateColumn } from '@prodtrack/db';
import type { DateRange } from './period';
import { buildDashboardRevision } from './stream';

/** Максимум строк в списке документов дашборда (M11 §8). */
export const DASHBOARD_DOCUMENT_LIMIT = 50;

/** Максимум документов, по которым считаются длительности этапов за период. */
export const DASHBOARD_TIMING_DOCUMENT_LIMIT = 200;

export interface DashboardDocumentRow {
  type: DocumentType;
  id: string;
  title: string;
  status: string;
  ageMs: number;
  href: string;
}

export interface InProductionLine {
  orderId: string;
  orderStatus: string;
  workCenterId: string;
  workCenterCode: string;
  workCenterName: string;
  lineStatus: string;
  productCode: string;
  productName: string;
  plannedQuantity: number;
}

export interface InProductionSummary {
  ordersCount: number;
  /** План по Массе, кг. */
  plannedMass: number;
  /** План по ГП (включая ПФ-позиции), шт. */
  plannedGp: number;
  workCenterCount: number;
  lines: InProductionLine[];
}

export interface TransferTotals {
  count: number;
  plannedQuantity: number;
}

export interface ReceivedTotals {
  count: number;
  quantity: number;
}

/**
 * Отпечаток состояния данных дашборда (M11 BR-2).
 *
 * Им пользуются и экран, и SSE-канал: канал шлёт его клиенту, а клиент сравнивает с тем,
 * что было при рендере, и обновляет страницу только при реальном изменении.
 */
export async function getDashboardRevision(): Promise<string> {
  const [orders, lines, timings, movements] = await Promise.all([
    prisma.productionOrder.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }),
    prisma.productionOrderLine.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }),
    prisma.stageTiming.aggregate({ _count: { _all: true }, _max: { transitionedAt: true } }),
    prisma.stockMovement.aggregate({ _count: { _all: true }, _max: { createdAt: true } }),
  ]);

  return buildDashboardRevision([
    { count: orders._count._all, lastAt: orders._max.updatedAt },
    { count: lines._count._all, lastAt: lines._max.updatedAt },
    { count: timings._count._all, lastAt: timings._max.transitionedAt },
    { count: movements._count._all, lastAt: movements._max.createdAt },
  ]);
}

/**
 * «Производится» (M11 BR-5): ПЗ текущей смены в статусе `CONFIRMED`/`IN_PROGRESS`.
 * Плюс виджет «статусы ПЗ текущей смены по РЦ» — строки тех же ПЗ.
 */
export async function getInProduction(
  now: Date,
  workCenterIds?: string[],
): Promise<InProductionSummary> {
  const lines = await prisma.productionOrderLine.findMany({
    where: {
      order: {
        status: { in: ['CONFIRMED', 'IN_PROGRESS'] },
        // T-075: «текущая смена» — сегодняшняя дата и текущий номер по Р-05.
        // Раньше хватало номера: справочник смен был шаблонным, и незакрытые ПЗ любой
        // давности попадали в показатель «производится».
        shift: {
          number: currentShiftNumber(now),
          date: shiftDateColumn(localDateKey(now)),
        },
      },
      ...(workCenterIds ? { workCenterId: { in: workCenterIds } } : {}),
    },
    select: {
      orderId: true,
      status: true,
      plannedQuantity: true,
      workCenter: { select: { id: true, code: true, name: true } },
      product: { select: { code: true, name: true, category: true } },
      order: { select: { status: true } },
    },
    orderBy: [{ workCenter: { code: 'asc' } }],
  });

  let plannedMass = 0;
  let plannedGp = 0;
  const orderIds = new Set<string>();
  const workCenters = new Set<string>();

  const items: InProductionLine[] = lines.map((line) => {
    const plannedQuantity = line.plannedQuantity.toNumber();
    if (line.product.category === 'MASS') {
      plannedMass += plannedQuantity;
    } else {
      plannedGp += plannedQuantity;
    }
    orderIds.add(line.orderId);
    workCenters.add(line.workCenter.id);

    return {
      orderId: line.orderId,
      orderStatus: line.order.status,
      workCenterId: line.workCenter.id,
      workCenterCode: line.workCenter.code,
      workCenterName: line.workCenter.name,
      lineStatus: line.status,
      productCode: line.product.code,
      productName: line.product.name,
      plannedQuantity,
    };
  });

  return {
    ordersCount: orderIds.size,
    plannedMass,
    plannedGp,
    workCenterCount: workCenters.size,
    lines: items,
  };
}

/** «Произведено» — итоги смен за период, по категориям (Р-08). */
export async function getProducedTotals(
  range: DateRange,
  workCenterIds?: string[],
): Promise<CategoryTotals> {
  const result = await prisma.shiftSummary.aggregate({
    where: {
      completedAt: { gte: range.from, lt: range.to },
      ...(workCenterIds ? { workCenterId: { in: workCenterIds } } : {}),
    },
    _sum: { massOutput: true, pfOutput: true, gpOutput: true },
  });

  return {
    mass: result._sum.massOutput?.toNumber() ?? 0,
    pf: result._sum.pfOutput?.toNumber() ?? 0,
    gp: result._sum.gpOutput?.toNumber() ?? 0,
  };
}

/**
 * «В перемещении» — открытые Перемещения (M11 UC-M11-1: `SUBMITTED`/`DISCREPANCY`).
 * Показатель — заявленное количество строк: по `SUBMITTED` фактического ещё нет,
 * а по `DISCREPANCY` оно не согласовано.
 */
export async function getInTransferTotals(): Promise<TransferTotals> {
  const transfers = await prisma.goodsTransfer.findMany({
    where: { status: { in: ['SUBMITTED', 'DISCREPANCY'] } },
    select: { id: true, lines: { select: { plannedQuantity: true } } },
  });

  return {
    count: transfers.length,
    plannedQuantity: transfers.reduce(
      (sum, transfer) =>
        sum + transfer.lines.reduce((lineSum, line) => lineSum + line.plannedQuantity.toNumber(), 0),
      0,
    ),
  };
}

/** «Принято на склад ГП за период» — приход ГП на склад готовой продукции (M05, M08). */
export async function getReceivedToFinishedGoods(range: DateRange): Promise<ReceivedTotals> {
  const result = await prisma.stockMovement.aggregate({
    where: {
      type: 'RECEIPT',
      stockCategory: 'GP',
      createdAt: { gte: range.from, lt: range.to },
      warehouse: { type: 'FINISHED_GOODS' },
    },
    _sum: { quantity: true },
    _count: { _all: true },
  });

  return {
    count: result._count._all,
    quantity: result._sum.quantity?.toNumber() ?? 0,
  };
}

function toTimingItem(record: {
  id: string;
  documentType: DocumentType;
  documentId: string;
  entityType: 'DOCUMENT' | 'LINE';
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

/**
 * «Длительности этапов» за период (M11 §8, M10).
 *
 * Считаются по тем же правилам, что экран «Хронометраж»: цепочка переходов строится по
 * каждой сущности отдельно (`buildStageDurationGroups`), затем одинаковые этапы складываются.
 */
export async function getStageDurationSummary(
  range: DateRange,
  documentIds?: string[],
): Promise<StageDurationSummary[]> {
  const recent = await prisma.stageTiming.findMany({
    where: {
      transitionedAt: { gte: range.from, lt: range.to },
      ...(documentIds ? { documentId: { in: documentIds } } : {}),
    },
    select: { documentId: true },
    distinct: ['documentId'],
    orderBy: { transitionedAt: 'desc' },
    take: DASHBOARD_TIMING_DOCUMENT_LIMIT,
  });

  const ids = recent.map((record) => record.documentId);
  if (ids.length === 0) {
    return [];
  }

  const records = await prisma.stageTiming.findMany({
    where: { documentId: { in: ids } },
    orderBy: { transitionedAt: 'asc' },
  });

  const durations = buildStageDurationGroups(records.map(toTimingItem))
    .flatMap((group) => group.stages)
    .filter((stage) => stage.durationMs !== null)
    .map((stage) => ({
      fromStatus: stage.fromStatus,
      toStatus: stage.toStatus ?? '',
      durationMs: stage.durationMs as number,
    }));

  return summarizeStageDurations(durations);
}

/**
 * Список документов жизненного цикла со статусами и возрастом (M11 BR-1, §8).
 *
 * ПЗ — все, где у ОПР есть строка своего РЦ; остальным ролям — все документы.
 */
export async function getDashboardDocuments(
  now: Date,
  filter: DashboardDocumentFilter,
  workCenterIds?: string[],
  /** Есть ли право читать Перемещения (`transfer:read`): у ОПР его нет (M02, решение 03.10.2026). */
  canReadTransfers = true,
): Promise<DashboardDocumentRow[]> {
  const orderStatus =
    filter.status !== 'ALL' && (PRODUCTION_ORDER_STATUSES as string[]).includes(filter.status)
      ? (filter.status as ProductionOrderStatus)
      : undefined;
  const transferStatus =
    filter.status !== 'ALL' && (GOODS_TRANSFER_STATUSES as string[]).includes(filter.status)
      ? (filter.status as GoodsTransferStatus)
      : undefined;

  const wantOrders =
    filter.type !== 'GOODS_TRANSFER' && (filter.status === 'ALL' || orderStatus !== undefined);
  // Документы, которые роль не имеет права открыть, в список не попадают: иначе ссылка
  // ведёт на экран «Доступ запрещён» (у ОПР нет `transfer:read`).
  const wantTransfers =
    canReadTransfers &&
    filter.type !== 'PRODUCTION_ORDER' &&
    (filter.status === 'ALL' || transferStatus !== undefined);

  const [orders, transfers] = await Promise.all([
    wantOrders
      ? prisma.productionOrder.findMany({
          where: {
            ...(orderStatus ? { status: orderStatus } : {}),
            ...(workCenterIds ? { lines: { some: { workCenterId: { in: workCenterIds } } } } : {}),
          },
          orderBy: { createdAt: 'desc' },
          take: DASHBOARD_DOCUMENT_LIMIT,
          select: { id: true, status: true, createdAt: true, shift: { select: { number: true } } },
        })
      : Promise.resolve([]),
    wantTransfers
      ? prisma.goodsTransfer.findMany({
          where: transferStatus ? { status: transferStatus } : {},
          orderBy: { createdAt: 'desc' },
          take: DASHBOARD_DOCUMENT_LIMIT,
          select: {
            id: true,
            status: true,
            createdAt: true,
            sourceWarehouse: { select: { name: true } },
            destinationWarehouse: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const ids = [...orders.map((order) => order.id), ...transfers.map((transfer) => transfer.id)];
  const lastTransitions = ids.length
    ? await prisma.stageTiming.groupBy({
        by: ['documentId'],
        where: { documentId: { in: ids }, entityType: 'DOCUMENT' },
        _max: { transitionedAt: true },
      })
    : [];
  const lastByDocument = new Map(
    lastTransitions.map((row) => [row.documentId, row._max.transitionedAt ?? null]),
  );

  const rows: DashboardDocumentRow[] = [
    ...orders.map((order) => ({
      type: 'PRODUCTION_ORDER' as const,
      id: order.id,
      title: 'ПЗ · Смена ' + order.shift.number,
      status: order.status as string,
      ageMs: documentAgeMs(now, lastByDocument.get(order.id) ?? null, order.createdAt),
      href: '/production-orders/' + order.id,
    })),
    ...transfers.map((transfer) => ({
      type: 'GOODS_TRANSFER' as const,
      id: transfer.id,
      title:
        'Перемещение · ' +
        transfer.sourceWarehouse.name +
        ' → ' +
        transfer.destinationWarehouse.name,
      status: transfer.status as string,
      ageMs: documentAgeMs(now, lastByDocument.get(transfer.id) ?? null, transfer.createdAt),
      href: '/transfers/' + transfer.id,
    })),
  ];

  // Дольше всех в статусе — наверх: именно такие документы требуют внимания (M11 §9).
  return rows.sort((left, right) => right.ageMs - left.ageMs);
}
