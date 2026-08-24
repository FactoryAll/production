'use server';

import { revalidatePath } from 'next/cache';
import type {
  ProductionOrder,
  ProductionOrderLine,
  ProductionOrderLineStatus,
  ProductionOrderStatus,
  EventCode,
  ProductionFact,
} from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma, writeAudit, writeTiming } from '@prodtrack/db';
import { requirePermission } from '@/lib/auth/access';
import { getAttributeRole } from '@prodtrack/contracts';
import {
  applyStockMovements,
  factCategoryToStockCategory,
} from '@/lib/stock-service';
import {
  validateProductionOrder,
  parsePositiveDecimal,
  type ProductionOrderLineInput,
} from '@/lib/validation/production-order';
import {
  checkAndCloseProductionOrder,
  transitionToInProgress,
} from '@/lib/production-order-closing';

export type CreateProductionOrderResult =
  | { success: true; id: string }
  | { success: false; error: string };

export type ConfirmProductionOrderResult =
  | { success: true }
  | { success: false; error: string };

export type UpdateProductionOrderResult =
  | { success: true }
  | { success: false; error: string };

export type SubstituteOperatorResult =
  | { success: true }
  | { success: false; error: string };

export type CancelProductionOrderResult =
  | { success: true }
  | { success: false; error: string };

export type CorrectProductionFactResult =
  | { success: true }
  | { success: false; error: string };


export interface CreateProductionOrderDeps {
  prisma: typeof prisma;
  writeAudit: typeof writeAudit;
  writeTiming: typeof writeTiming;
  requirePermission: typeof requirePermission;
  applyStockMovements?: typeof applyStockMovements;
}

export type PrismaLike = CreateProductionOrderDeps['prisma'];

// TODO T-031: реализовать подтверждение получения (EV-02)
export async function createProductionOrder(
  input: { shiftId: string; lines: ProductionOrderLineInput[] },
  deps: CreateProductionOrderDeps = { prisma, writeAudit, writeTiming, requirePermission },
): Promise<ProductionOrder & { lines: ProductionOrderLine[] }> {
  const session = await deps.requirePermission('production_order:create');
  const userId = session.userId;
  const roles = session.user.roles.map((ur) => ur.role.code);

  const validation = await validateProductionOrder(input, deps.prisma);
  if (!validation.valid) {
    throw new Error(validation.errors.join('; '));
  }

  const workCenterIds = [...new Set(input.lines.map((line) => line.workCenterId))];
  const productIds = [...new Set(input.lines.map((line) => line.productId))];
  const operatorIds = [...new Set(input.lines.map((line) => line.operatorId).filter(Boolean))];

  const [workCenters, products, employees] = await Promise.all([
    deps.prisma.workCenter.findMany({ where: { id: { in: workCenterIds } } }),
    deps.prisma.product.findMany({ where: { id: { in: productIds } } }),
    deps.prisma.employee.findMany({ where: { id: { in: operatorIds } } }),
  ]);

  const workCenterById = new Map(workCenters.map((wc) => [wc.id, wc]));
  const productById = new Map(products.map((p) => [p.id, p]));
  const employeeById = new Map(employees.map((e) => [e.id, e]));

  const parsedLines = input.lines.map((line) => {
    const workCenter = workCenterById.get(line.workCenterId);
    const product = productById.get(line.productId);
    const operator = employeeById.get(line.operatorId);
    // Валидация выше гарантирует существование и активность.
    if (!workCenter || !product || !operator) {
      throw new Error('Непредвиденная ошибка валидации');
    }
    return {
      workCenterId: workCenter.id,
      productId: product.id,
      plannedQuantity: parsePositiveDecimal(line.plannedQuantity),
      operatorId: operator.id,
      workerIds: line.workerIds?.filter((id) => Boolean(id)) ?? [],
    };
  });

  const result = await deps.prisma.$transaction(async (tx) => {
    const order = await tx.productionOrder.create({
      data: {
        shiftId: input.shiftId,
        status: 'DRAFT',
        createdById: userId,
        lines: {
          create: parsedLines.map((line) => ({
            workCenterId: line.workCenterId,
            productId: line.productId,
            plannedQuantity: line.plannedQuantity,
            operatorId: line.operatorId,
            status: 'ASSIGNED',
            workerAssignments: {
              create: line.workerIds.map((employeeId) => ({ employeeId })),
            },
          })),
        },
      },
      include: { lines: true },
    });

    await deps.writeAudit(tx, {
      action: 'CREATE',
      objectType: 'ProductionOrder',
      objectId: order.id,
      userId,
      userRoles: roles,
      permission: 'production_order:create',
      newValue: JSON.stringify({
        shiftId: order.shiftId,
        status: order.status,
        linesCount: order.lines.length,
      }),
    });

    await deps.writeTiming(tx, {
      documentType: 'PRODUCTION_ORDER',
      documentId: order.id,
      entityType: 'DOCUMENT',
      entityId: order.id,
      fromStatus: '',
      toStatus: 'DRAFT',
      initiatorRole: 'NP',
      initiatorId: userId,
    });

    return order;
  });

  revalidatePath('/production-orders');
  return result;
}

export async function createProductionOrderAction(formData: FormData): Promise<CreateProductionOrderResult> {
  try {
    const shiftId = formData.get('shiftId') as string;
    const linesRaw = formData.get('lines') as string;
    const lines: ProductionOrderLineInput[] = linesRaw ? JSON.parse(linesRaw) : [];

    const order = await createProductionOrder({ shiftId, lines });
    return { success: true, id: order.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Не удалось создать ПЗ';
    return { success: false, error: message };
  }
}

export async function getProductionOrderCreateData() {
  await requirePermission('production_order:create');

  const [shifts, workCenters, products, employees] = await Promise.all([
    prisma.shift.findMany({
      where: { active: true },
      orderBy: [{ date: 'desc' }, { number: 'asc' }],
    }),
    prisma.workCenter.findMany({
      where: { active: true },
      orderBy: { code: 'asc' },
    }),
    prisma.product.findMany({
      where: { active: true },
      orderBy: { code: 'asc' },
    }),
    prisma.employee.findMany({
      where: { active: true },
      orderBy: { fullName: 'asc' },
    }),
  ]);

  return { shifts, workCenters, products, employees };
}

export async function confirmProductionOrder(
  orderId: string,
  deps: CreateProductionOrderDeps = { prisma, writeAudit, writeTiming, requirePermission },
): Promise<ProductionOrder & { lines: ProductionOrderLine[] }> {
  const session = await deps.requirePermission('production_order:confirm');
  const userId = session.userId;
  const roles = session.user.roles.map((ur) => ur.role.code);

  const order = await deps.prisma.productionOrder.findUnique({
    where: { id: orderId },
    include: {
      shift: true,
      lines: {
        include: {
          operator: true,
        },
      },
    },
  });

  if (!order) {
    throw new Error('ПЗ не найдено');
  }

  if (order.status !== 'DRAFT') {
    throw new Error('ПЗ нельзя подтвердить в этом статусе');
  }

  if (order.lines.length === 0) {
    throw new Error('ПЗ не содержит строк');
  }

  for (const line of order.lines) {
    if (!line.workCenterId || !line.productId || line.plannedQuantity.lessThanOrEqualTo(0) || !line.operatorId) {
      throw new Error('ПЗ содержит неполную строку (строка ' + line.id.slice(0, 8) + ')');
    }
  }

  const confirmedAt = new Date();
  const uniqueOperatorIds = [...new Set(order.lines.map((line) => line.operatorId).filter((id): id is string => Boolean(id)))];

  const result = await deps.prisma.$transaction(async (tx) => {
    const updated = await tx.productionOrder.update({
      where: { id: orderId },
      data: {
        status: 'CONFIRMED',
        confirmedAt,
        confirmedByUserId: userId,
      },
      include: { lines: true },
    });

    await deps.writeAudit(tx, {
      action: 'UPDATE',
      objectType: 'ProductionOrder',
      objectId: order.id,
      field: 'status',
      oldValue: 'DRAFT',
      newValue: 'CONFIRMED',
      userId,
      userRoles: roles,
      permission: 'production_order:confirm',
    });

    await deps.writeTiming(tx, {
      documentType: 'PRODUCTION_ORDER',
      documentId: order.id,
      entityType: 'DOCUMENT',
      entityId: order.id,
      fromStatus: 'DRAFT',
      toStatus: 'CONFIRMED',
      initiatorRole: 'NP',
      initiatorId: userId,
    });

    if (uniqueOperatorIds.length > 0) {
      const shiftName = 'Смена ' + order.shift.number;
      await tx.notification.createMany({
        data: uniqueOperatorIds.map((recipientId) => ({
          eventCode: 'EV_01',
          recipientId,
          title: 'Подтверждено производственное задание',
          body: JSON.stringify({
            orderId: order.id,
            shiftId: order.shift.id,
            shiftName,
            linesCount: order.lines.length,
            confirmedAt,
          }),
          deepLink: '/production-orders/' + order.id,
        })),
      });
    }

    return updated;
  });

  revalidatePath('/production-orders');
  revalidatePath('/production-orders/' + orderId);
  return result;
}

export async function confirmProductionOrderAction(orderId: string): Promise<ConfirmProductionOrderResult> {
  try {
    await confirmProductionOrder(orderId);
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Не удалось подтвердить ПЗ';
    return { success: false, error: message };
  }
}

const EDITABLE_STATUSES: ProductionOrderStatus[] = ['DRAFT', 'CONFIRMED', 'IN_PROGRESS'];

export async function updateProductionOrder(
  orderId: string,
  input: { shiftId: string; lines: ProductionOrderLineInput[] },
  deps: CreateProductionOrderDeps = { prisma, writeAudit, writeTiming, requirePermission },
): Promise<ProductionOrder & { lines: ProductionOrderLine[] }> {
  const session = await deps.requirePermission('production_order:update');
  const userId = session.userId;
  const roles = session.user.roles.map((ur) => ur.role.code);

  const order = await deps.prisma.productionOrder.findUnique({
    where: { id: orderId },
    include: { lines: true },
  });
  if (!order) {
    throw new Error('ПЗ не найдено');
  }

  if (!EDITABLE_STATUSES.includes(order.status)) {
    throw new Error('ПЗ нельзя корректировать в этом статусе');
  }

  const reported = order.lines.some((line) => line.status === 'REPORTED');
  if (reported) {
    throw new Error('Корректировка невозможна после внесения итога (строка в статусе REPORTED)');
  }

  const validation = await validateProductionOrder(input, deps.prisma);
  if (!validation.valid) {
    throw new Error(validation.errors.join('; '));
  }

  const workCenterIds = [...new Set(input.lines.map((line) => line.workCenterId))];
  const productIds = [...new Set(input.lines.map((line) => line.productId))];
  const operatorIds = [...new Set(input.lines.map((line) => line.operatorId).filter(Boolean))];

  const [workCenters, products, employees] = await Promise.all([
    deps.prisma.workCenter.findMany({ where: { id: { in: workCenterIds } } }),
    deps.prisma.product.findMany({ where: { id: { in: productIds } } }),
    deps.prisma.employee.findMany({ where: { id: { in: operatorIds } } }),
  ]);

  const workCenterById = new Map(workCenters.map((wc) => [wc.id, wc]));
  const productById = new Map(products.map((p) => [p.id, p]));
  const employeeById = new Map(employees.map((e) => [e.id, e]));

  const oldLines = order.lines.map((line) => ({
    workCenterId: line.workCenterId,
    productId: line.productId,
    plannedQuantity: line.plannedQuantity.toString(),
    operatorId: line.operatorId,
    status: line.status,
  }));

  const newLines = input.lines.map((line) => {
    const workCenter = workCenterById.get(line.workCenterId);
    const product = productById.get(line.productId);
    const operator = employeeById.get(line.operatorId);
    if (!workCenter || !product || !operator) {
      throw new Error('Непредвиденная ошибка валидации');
    }
    return {
      workCenterId: workCenter.id,
      productId: product.id,
      plannedQuantity: parsePositiveDecimal(line.plannedQuantity),
      operatorId: operator.id,
      workerIds: line.workerIds?.filter((id) => Boolean(id)) ?? [],
    };
  });

  const result = await deps.prisma.$transaction(async (tx) => {
    await tx.productionOrder.update({
      where: { id: orderId },
      data: { shiftId: input.shiftId, updatedAt: new Date() },
    });

    await tx.productionOrderLine.deleteMany({ where: { orderId } });

    await Promise.all(
      newLines.map((line) =>
        tx.productionOrderLine.create({
          data: {
            orderId,
            workCenterId: line.workCenterId,
            productId: line.productId,
            plannedQuantity: line.plannedQuantity,
            operatorId: line.operatorId,
            status: 'ASSIGNED',
            workerAssignments: {
              create: line.workerIds.map((employeeId) => ({ employeeId })),
            },
          },
        }),
      ),
    );

    const updated = await tx.productionOrder.findUnique({
      where: { id: orderId },
      include: { lines: true },
    });
    if (!updated) {
      throw new Error('ПЗ не найдено после корректировки');
    }

    await deps.writeAudit(tx, {
      action: 'UPDATE',
      objectType: 'ProductionOrder',
      objectId: order.id,
      field: 'lines',
      oldValue: JSON.stringify(oldLines),
      newValue: JSON.stringify(newLines),
      userId,
      userRoles: roles,
      permission: 'production_order:update',
    });

    await deps.writeTiming(tx, {
      documentType: 'PRODUCTION_ORDER',
      documentId: order.id,
      entityType: 'DOCUMENT',
      entityId: order.id,
      fromStatus: order.status,
      toStatus: order.status,
      initiatorRole: 'NP',
      initiatorId: userId,
    });

    return updated;
  });

  revalidatePath('/production-orders');
  revalidatePath('/production-orders/' + orderId);
  return result;
}

export async function updateProductionOrderAction(
  orderId: string,
  formData: FormData,
): Promise<UpdateProductionOrderResult> {
  try {
    const shiftId = formData.get('shiftId') as string;
    const linesRaw = formData.get('lines') as string;
    const lines: ProductionOrderLineInput[] = linesRaw ? JSON.parse(linesRaw) : [];

    await updateProductionOrder(orderId, { shiftId, lines });
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Не удалось изменить ПЗ';
    return { success: false, error: message };
  }
}

const SUBSTITUTION_REASON_CODES = ['ILLNESS', 'NO_SHOW', 'LEFT_SHIFT', 'OTHER'] as const;
type SubstitutionReasonCode = (typeof SUBSTITUTION_REASON_CODES)[number];

function isSubstitutionReasonCode(value: unknown): value is SubstitutionReasonCode {
  return typeof value === 'string' && SUBSTITUTION_REASON_CODES.includes(value as SubstitutionReasonCode);
}

async function findS1CUserIds(client: { user: { findMany: typeof prisma.user.findMany } }): Promise<string[]> {
  const users = await client.user.findMany({
    where: { roles: { some: { role: { code: 'S1C' } } } },
    select: { id: true },
  });
  return users.map((u: { id: string }) => u.id);
}

export async function substituteOperator(
  lineId: string,
  input: { reasonCode: string; comment: string },
  deps: CreateProductionOrderDeps = { prisma, writeAudit, writeTiming, requirePermission },
): Promise<void> {
  const session = await deps.requirePermission('production_order:confirm');
  const userId = session.userId;
  const roles = session.user.roles.map((ur) => ur.role.code);

  const line = await deps.prisma.productionOrderLine.findUnique({
    where: { id: lineId },
    include: { order: true, operator: true },
  });
  if (!line) {
    throw new Error('Строка ПЗ не найдена');
  }

  const editableLineStatuses: ProductionOrderLineStatus[] = ['ASSIGNED', 'ACCEPTED'];
  if (!editableLineStatuses.includes(line.status)) {
    throw new Error('Строка уже в REPORTED');
  }

  if (!isSubstitutionReasonCode(input.reasonCode)) {
    throw new Error('Недопустимый код причины ввода за Оператора');
  }
  const reasonCode = input.reasonCode;

  const comment = input.comment.trim();
  if (comment.length === 0) {
    throw new Error('Комментарий обязателен');
  }

  const operatorId = line.operatorId;
  const orderId = line.orderId;
  const oldStatus = line.status;

  const attributedRole = (() => {
    const match = roles.find((role) => role === 'NP' || role === 'ADM');
    return match ?? undefined;
  })();

  await deps.prisma.$transaction(async (tx) => {
    await tx.productionOrderLine.update({
      where: { id: lineId },
      data: { status: 'REPORTED' },
    });

    await deps.writeAudit(tx, {
      action: 'UPDATE',
      objectType: 'ProductionOrderLine',
      objectId: lineId,
      field: 'status',
      oldValue: oldStatus,
      newValue: 'REPORTED',
      userId,
      userRoles: roles,
      permission: 'production_order:confirm',
    });

    await deps.writeAudit(tx, {
      action: 'UPDATE',
      objectType: 'ProductionOrderLine',
      objectId: lineId,
      field: 'substitution',
      oldValue: undefined,
      newValue: JSON.stringify({ reasonCode, comment }),
      userId,
      userRoles: roles,
      permission: 'production_order:confirm',
    });

    await deps.writeTiming(tx, {
      documentType: 'PRODUCTION_ORDER',
      documentId: lineId,
      entityType: 'LINE',
      entityId: lineId,
      fromStatus: oldStatus,
      toStatus: 'REPORTED',
      initiatorRole: attributedRole,
      initiatorId: userId,
    });

    await transitionToInProgress(orderId, tx as unknown as PrismaLike, session);
    await checkAndCloseProductionOrder(orderId, tx as unknown as PrismaLike, session);

    const recipientIds = new Set<string>();
    if (operatorId) {
      recipientIds.add(operatorId);
    }
    const s1cUserIds = await findS1CUserIds(tx as unknown as PrismaLike);
    for (const id of s1cUserIds) {
      recipientIds.add(id);
    }

    const uniqueRecipientIds = [...recipientIds];
    if (uniqueRecipientIds.length > 0) {
      await tx.notification.createMany({
        data: uniqueRecipientIds.map((recipientId) => ({
          eventCode: 'EV_08' as EventCode,
          recipientId,
          title: 'Смена закрыта за Оператора',
          body: JSON.stringify({
            orderId,
            lineId,
            operatorId,
            reasonCode,
            comment,
          }),
          deepLink: '/production-orders/' + orderId,
        })),
      });
    }

    if (s1cUserIds.length > 0) {
      await tx.notification.createMany({
        data: s1cUserIds.map((recipientId) => ({
          eventCode: 'EV_03' as EventCode,
          recipientId,
          title: 'Итог смены внесён',
          body: JSON.stringify({ orderId, lineId }),
          deepLink: '/production-orders/' + orderId,
        })),
      });
    }
  });

  revalidatePath('/production-orders');
  revalidatePath('/production-orders/' + orderId);
}

export async function substituteOperatorAction(
  lineId: string,
  formData: FormData,
): Promise<SubstituteOperatorResult> {
  try {
    const reasonCode = formData.get('reasonCode') as string;
    const comment = formData.get('comment') as string;
    await substituteOperator(lineId, { reasonCode, comment });
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Не удалось внести итог за Оператора';
    return { success: false, error: message };
  }
}

const CANCELLABLE_STATUSES: ProductionOrderStatus[] = ['DRAFT', 'CONFIRMED'];

export async function cancelProductionOrder(
  orderId: string,
  input: { reason: string },
  deps: CreateProductionOrderDeps = { prisma, writeAudit, writeTiming, requirePermission },
): Promise<ProductionOrder & { lines: ProductionOrderLine[] }> {
  const session = await deps.requirePermission('production_order:confirm');
  const userId = session.userId;
  const roles = session.user.roles.map((ur) => ur.role.code);

  const reason = input.reason.trim();
  if (reason.length === 0) {
    throw new Error('Укажите причину отмены');
  }

  const order = await deps.prisma.productionOrder.findUnique({
    where: { id: orderId },
    include: {
      shift: true,
      lines: {
        include: {
          operator: true,
        },
      },
    },
  });

  if (!order) {
    throw new Error('ПЗ не найдено');
  }

  if (!CANCELLABLE_STATUSES.includes(order.status)) {
    throw new Error('ПЗ нельзя отменить в этом статусе');
  }

  const hasReportedLine = order.lines.some((line) => line.status === 'REPORTED');
  if (hasReportedLine) {
    throw new Error('Отмена невозможна: есть строка в статусе REPORTED');
  }

  const cancelledAt = new Date();
  const uniqueOperatorIds = [
    ...new Set(order.lines.map((line) => line.operatorId).filter((id): id is string => Boolean(id))),
  ];

  const attributedRole = getAttributeRole(roles, 'production_order:confirm') ?? undefined;

  const result = await deps.prisma.$transaction(async (tx) => {
    const updated = await tx.productionOrder.update({
      where: { id: orderId },
      data: {
        status: 'CANCELLED',
        cancelledAt,
        cancelledByUserId: userId,
        cancellationReason: reason,
      },
      include: { lines: true },
    });

    await deps.writeAudit(tx, {
      action: 'CANCEL',
      objectType: 'ProductionOrder',
      objectId: order.id,
      field: 'status',
      oldValue: order.status,
      newValue: 'CANCELLED',
      userId,
      userRoles: roles,
      permission: 'production_order:confirm',
    });

    await deps.writeAudit(tx, {
      action: 'CANCEL',
      objectType: 'ProductionOrder',
      objectId: order.id,
      field: 'cancellationReason',
      oldValue: undefined,
      newValue: reason,
      userId,
      userRoles: roles,
      permission: 'production_order:confirm',
    });

    await deps.writeTiming(tx, {
      documentType: 'PRODUCTION_ORDER',
      documentId: order.id,
      entityType: 'DOCUMENT',
      entityId: order.id,
      fromStatus: order.status,
      toStatus: 'CANCELLED',
      initiatorRole: attributedRole,
      initiatorId: userId,
    });

    if (uniqueOperatorIds.length > 0) {
      await tx.notification.createMany({
        data: uniqueOperatorIds.map((recipientId) => ({
          eventCode: 'EV_09' as EventCode,
          recipientId,
          title: 'Производственное задание отменено',
          body: JSON.stringify({
            orderId: order.id,
            reason,
            cancelledAt,
          }),
          deepLink: '/production-orders/' + order.id,
        })),
      });
    }

    return updated;
  });

  revalidatePath('/production-orders');
  revalidatePath('/production-orders/' + orderId);
  return result;
}

export async function cancelProductionOrderAction(
  orderId: string,
  formData: FormData,
): Promise<CancelProductionOrderResult> {
  try {
    const reason = formData.get('reason') as string;
    await cancelProductionOrder(orderId, { reason });
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Не удалось отменить ПЗ';
    return { success: false, error: message };
  }
}

const CORRECTABLE_STATUSES: ProductionOrderStatus[] = ['COMPLETED'];

function parseNonNegativeDecimal(value: unknown): Prisma.Decimal {
  const raw = value as Prisma.Decimal.Value;
  if (raw instanceof Prisma.Decimal) {
    if (raw.lessThan(0)) {
      throw new Error('Значение не может быть отрицательным');
    }
    return raw;
  }

  const str = typeof raw === 'string' ? raw.trim() : String(raw);
  if (!str) {
    throw new Error('Значение не может быть отрицательным');
  }

  const normalized = str.replace(',', '.');
  const num = Number(normalized);
  if (!Number.isFinite(num) || num < 0) {
    throw new Error('Значение не может быть отрицательным');
  }

  return new Prisma.Decimal(num);
}

function parseNonNegativeInteger(value: unknown): number {
  if (value === undefined || value === null || value === '') return 0;
  const num = Number(value);
  if (Number.isNaN(num) || !Number.isInteger(num) || num < 0) {
    throw new Error('Значение должно быть целым неотрицательным числом');
  }
  return num;
}

export async function correctProductionFact(
  factId: string,
  input: {
    quantity: number;
    defectQuantity?: number;
    defectReasonId?: string;
    stopsDurationMinutes?: number;
    correctionReason: string;
  },
  deps: CreateProductionOrderDeps = { prisma, writeAudit, writeTiming, requirePermission },
): Promise<ProductionFact> {
  const session = await deps.requirePermission('production_order:confirm');
  const userId = session.userId;
  const roles = session.user.roles.map((ur) => ur.role.code);

  const correctionReason = input.correctionReason.trim();
  if (correctionReason.length === 0) {
    throw new Error('Причина корректировки обязательна');
  }

  const quantity = parseNonNegativeDecimal(input.quantity);
  const defectQuantity = parseNonNegativeDecimal(input.defectQuantity ?? 0);
  const stopsDurationMinutes = parseNonNegativeInteger(input.stopsDurationMinutes ?? 0);

  if (defectQuantity.greaterThan(0) && !input.defectReasonId) {
    throw new Error('Укажите причину брака');
  }

  const fact = await deps.prisma.productionFact.findUnique({
    where: { id: factId },
    include: {
      line: {
        include: {
          order: true,
        },
      },
    },
  });

  if (!fact) {
    throw new Error('Факт не найден');
  }

  if (!CORRECTABLE_STATUSES.includes(fact.line.order.status)) {
    throw new Error('Корректировка факта возможна только после закрытия ПЗ');
  }

  const orderId = fact.line.order.id;
  const lineId = fact.line.id;
  const attributedRole = getAttributeRole(roles, 'production_order:confirm') ?? undefined;

  const oldValues = {
    quantity: fact.quantity.toString(),
    defectQuantity: fact.defectQuantity.toString(),
    defectReasonId: fact.defectReasonId,
    stopsDurationMinutes: fact.stopsDurationMinutes,
  };

  const newValues = {
    quantity: quantity.toString(),
    defectQuantity: defectQuantity.toString(),
    defectReasonId: input.defectReasonId ?? null,
    stopsDurationMinutes,
  };

  const result = await deps.prisma.$transaction(async (tx) => {
    const updated = await tx.productionFact.update({
      where: { id: factId },
      data: {
        quantity,
        defectQuantity,
        defectReasonId: input.defectReasonId ?? null,
        stopsDurationMinutes,
        postCompletionCorrection: true,
        correctionReason,
        updatedAt: new Date(),
      },
    });

    const correctionDelta = quantity.minus(fact.quantity);
    if (!correctionDelta.equals(0)) {
      const productionWarehouse = await tx.warehouse.findFirstOrThrow({
        where: { type: 'PRODUCTION' },
      });
      await (deps.applyStockMovements ?? applyStockMovements)(tx, [
        {
          warehouseId: productionWarehouse.id,
          productId: fact.productId,
          stockCategory: factCategoryToStockCategory(fact.factCategory),
          type: correctionDelta.greaterThan(0)
            ? 'RECEIPT'
            : 'CONSUMPTION',
          quantity: correctionDelta.absoluteValue(),
          sourceType: 'FACT_CORRECTION',
          sourceId: fact.id,
        },
      ]);
    }

    await deps.writeAudit(tx, {
      action: 'UPDATE',
      objectType: 'ProductionFact',
      objectId: factId,
      field: 'quantity,defectQuantity,defectReasonId,stopsDurationMinutes',
      oldValue: JSON.stringify(oldValues),
      newValue: JSON.stringify(newValues),
      userId,
      userRoles: roles,
      permission: 'production_order:confirm',
    });

    await deps.writeAudit(tx, {
      action: 'UPDATE',
      objectType: 'ProductionFact',
      objectId: factId,
      field: 'postCompletionCorrection',
      oldValue: 'false',
      newValue: 'true',
      userId,
      userRoles: roles,
      permission: 'production_order:confirm',
    });

    await deps.writeAudit(tx, {
      action: 'UPDATE',
      objectType: 'ProductionFact',
      objectId: factId,
      field: 'correctionReason',
      oldValue: undefined,
      newValue: correctionReason,
      userId,
      userRoles: roles,
      permission: 'production_order:confirm',
    });

    await deps.writeTiming(tx, {
      documentType: 'PRODUCTION_ORDER',
      documentId: orderId,
      entityType: 'LINE',
      entityId: lineId,
      fromStatus: 'REPORTED',
      toStatus: 'REPORTED',
      initiatorRole: attributedRole,
      initiatorId: userId,
    });

    return updated;
  });

  revalidatePath('/production-orders');
  revalidatePath('/production-orders/' + orderId);
  return result;
}

export async function correctProductionFactAction(
  factId: string,
  formData: FormData,
): Promise<CorrectProductionFactResult> {
  try {
    const quantity = Number(formData.get('quantity'));
    const defectQuantityRaw = formData.get('defectQuantity');
    const defectQuantity = defectQuantityRaw ? Number(defectQuantityRaw) : undefined;
    const defectReasonId = formData.get('defectReasonId') as string | undefined;
    const stopsDurationMinutesRaw = formData.get('stopsDurationMinutes');
    const stopsDurationMinutes = stopsDurationMinutesRaw ? Number(stopsDurationMinutesRaw) : undefined;
    const correctionReason = formData.get('correctionReason') as string;

    await correctProductionFact(factId, {
      quantity,
      defectQuantity,
      defectReasonId: defectReasonId || undefined,
      stopsDurationMinutes,
      correctionReason,
    });
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Не удалось скорректировать факт';
    return { success: false, error: message };
  }
}

export async function getProductionOrderById(id: string) {
  await requirePermission('production_order:read');

  const [order, defectReasons] = await Promise.all([
    prisma.productionOrder.findUnique({
      where: { id },
      include: {
        shift: true,
        createdBy: { select: { id: true, login: true } },
        confirmedBy: { select: { id: true, login: true } },
        cancelledBy: { select: { id: true, login: true } },
        lines: {
          include: {
            workCenter: true,
            product: true,
            operator: true,
            facts: {
              include: {
                defectReason: true,
              },
            },
            workerAssignments: {
              include: {
                employee: true,
              },
            },
          },
        },
      },
    }),
    prisma.defectReason.findMany({
      where: { active: true },
      orderBy: { code: 'asc' },
    }),
  ]);

  return { order, defectReasons };
}

export async function getProductionOrders() {
  await requirePermission('production_order:read');

  return prisma.productionOrder.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      shift: true,
      lines: {
        include: {
          workCenter: true,
        },
      },
    },
  });
}

