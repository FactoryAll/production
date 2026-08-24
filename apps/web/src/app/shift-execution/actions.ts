'use server';

import { revalidatePath } from 'next/cache';
import { Prisma, type ProductionOrderLine, type ProductionFact, type ProductCategory } from '@prisma/client';
import { prisma, writeAudit, writeTiming } from '@prodtrack/db';
import { requireShiftWindow } from '@/lib/auth/require-shift-window';
import { hasPermission, getAttributeRole } from '@prodtrack/contracts';
import {
  checkAndCloseProductionOrder,
  transitionToInProgress,
} from '@/lib/production-order-closing';

export type AcceptLineResult =
  | { success: true }
  | { success: false; error: string };

export type ReportFactResult =
  | { success: true }
  | { success: false; error: string };

export interface AcceptLineDeps {
  prisma: typeof prisma;
  writeAudit: typeof writeAudit;
  writeTiming: typeof writeTiming;
  requireShiftWindow: typeof requireShiftWindow;
}

export interface ReportFactDeps {
  prisma: typeof prisma;
  writeAudit: typeof writeAudit;
  writeTiming: typeof writeTiming;
  requireShiftWindow: typeof requireShiftWindow;
}

export type FactCategoryInput = 'MASS' | 'GP' | 'PF';

export interface ReportFactInput {
  quantity: number;
  factCategory: FactCategoryInput;
  defectQuantity?: number;
  defectReasonId?: string;
  stopsCount?: number;
  stopsDurationMinutes?: number;
}

function assertStatusTransitionAllowed(
  line: ProductionOrderLine & { order: { id: string; status: string } },
  userEmployeeId: string | null,
) {
  if (line.operatorId !== userEmployeeId) {
    throw new Error('Внести итог может только Оператор, назначенный на этот РЦ');
  }

  if (line.status !== 'ACCEPTED') {
    throw new Error('Строка не готова к вводу итога');
  }

  if (line.order.status !== 'CONFIRMED' && line.order.status !== 'IN_PROGRESS') {
    throw new Error('ПЗ не может принять итог в этом статусе');
  }
}

function resolveFactCategory(productCategory: ProductCategory, input: FactCategoryInput): FactCategoryInput {
  if (productCategory === 'MASS') {
    if (input !== 'MASS') {
      throw new Error('Для массового продукта категория факта всегда MASS');
    }
    return 'MASS';
  }
  if (productCategory === 'GP') {
    if (input !== 'GP' && input !== 'PF') {
      throw new Error('Для готовой продукции разрешены категории GP или PF');
    }
    return input;
  }
  throw new Error('Неизвестная категория продукта');
}

function parseNonNegativeDecimal(value: unknown): Prisma.Decimal {
  if (value === undefined || value === null || value === '') {
    return new Prisma.Decimal(0);
  }
  const num = Number(value);
  if (Number.isNaN(num) || !Number.isFinite(num) || num < 0) {
    throw new Error('Значение не может быть отрицательным');
  }
  return new Prisma.Decimal(num);
}

function parseNonNegativeInteger(value: unknown): number {
  if (value === undefined || value === null || value === '') {
    return 0;
  }
  const num = Number(value);
  if (Number.isNaN(num) || !Number.isInteger(num) || num < 0) {
    throw new Error('Значение должно быть целым неотрицательным числом');
  }
  return num;
}

function parseFactCategory(value: unknown): FactCategoryInput {
  const v = String(value).toUpperCase();
  if (v === 'MASS' || v === 'GP' || v === 'PF') {
    return v;
  }
  throw new Error('Недопустимая категория факта');
}

export async function acceptProductionOrderLine(
  lineId: string,
  deps: AcceptLineDeps = { prisma, writeAudit, writeTiming, requireShiftWindow },
): Promise<ProductionOrderLine> {
  const session = await deps.requireShiftWindow();
  const userRoles = session.user.roles.map((ur) => ur.role.code);

  if (!hasPermission(userRoles, 'production_order:accept')) {
    throw new Error('Forbidden: insufficient permissions');
  }

  const line = await deps.prisma.productionOrderLine.findUnique({
    where: { id: lineId },
    include: {
      operator: true,
      order: true,
    },
  });

  if (!line) {
    throw new Error('Строка ПЗ не найдена');
  }

  if (line.operatorId !== session.user.employeeId) {
    throw new Error('Подтвердить получение может только Оператор, назначенный на этот РЦ');
  }

  if (line.status !== 'ASSIGNED') {
    throw new Error('Строка уже подтверждена или введён итог');
  }

  if (line.order.status !== 'CONFIRMED' && line.order.status !== 'IN_PROGRESS') {
    throw new Error('ПЗ не может быть принят в работу в этом статусе');
  }

  const attributedRole = getAttributeRole(userRoles, 'production_order:accept') ?? undefined;

  const result = await deps.prisma.$transaction(async (tx) => {
    const updated = await tx.productionOrderLine.update({
      where: { id: lineId },
      data: { status: 'ACCEPTED' },
    });

    await deps.writeAudit(tx, {
      action: 'UPDATE',
      objectType: 'ProductionOrderLine',
      objectId: lineId,
      field: 'status',
      oldValue: 'ASSIGNED',
      newValue: 'ACCEPTED',
      userId: session.userId,
      userRoles,
      permission: 'production_order:accept',
    });

    await deps.writeTiming(tx, {
      documentType: 'PRODUCTION_ORDER',
      documentId: line.order.id,
      entityType: 'LINE',
      entityId: lineId,
      fromStatus: 'ASSIGNED',
      toStatus: 'ACCEPTED',
      initiatorRole: attributedRole,
      initiatorId: session.userId,
    });

    const npUsers = await tx.user.findMany({
      where: {
        roles: {
          some: {
            role: { code: 'NP' },
          },
        },
      },
      select: { id: true },
    });

    const recipientIds = npUsers.map((u) => u.id);
    if (recipientIds.length > 0) {
      await tx.notification.createMany({
        data: recipientIds.map((recipientId) => ({
          eventCode: 'EV_02' as const,
          recipientId,
          title: 'Оператор подтвердил получение ПЗ',
          body: JSON.stringify({
            orderId: line.order.id,
            lineId,
            workCenterId: line.workCenterId,
            operatorId: line.operatorId,
          }),
          deepLink: '/production-orders/' + line.order.id,
        })),
      });
    }

    await transitionToInProgress(line.order.id, tx, session);
    await checkAndCloseProductionOrder(line.order.id, tx, session);

    return updated;
  });

  revalidatePath('/shift-execution');
  revalidatePath('/production-orders/' + line.order.id);
  return result;
}

export async function acceptProductionOrderLineAction(lineId: string): Promise<AcceptLineResult> {
  try {
    await acceptProductionOrderLine(lineId);
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Не удалось подтвердить получение';
    return { success: false, error: message };
  }
}

export async function reportProductionFact(
  lineId: string,
  input: ReportFactInput,
  deps: ReportFactDeps = { prisma, writeAudit, writeTiming, requireShiftWindow },
): Promise<ProductionFact> {
  const session = await deps.requireShiftWindow();
  const userRoles = session.user.roles.map((ur) => ur.role.code);

  if (!hasPermission(userRoles, 'production_order:report')) {
    throw new Error('Forbidden: insufficient permissions');
  }

  const line = await deps.prisma.productionOrderLine.findUnique({
    where: { id: lineId },
    include: {
      operator: true,
      order: true,
      product: true,
    },
  });

  if (!line) {
    throw new Error('Строка ПЗ не найдена');
  }

  assertStatusTransitionAllowed(
    line as unknown as ProductionOrderLine & { order: { id: string; status: string } },
    session.user.employeeId,
  );

  const quantity = parseNonNegativeDecimal(input.quantity);
  const defectQuantity = parseNonNegativeDecimal(input.defectQuantity);
  const stopsCount = parseNonNegativeInteger(input.stopsCount);
  const stopsDurationMinutes = parseNonNegativeInteger(input.stopsDurationMinutes);

  if (defectQuantity.greaterThan(0) && !input.defectReasonId) {
    throw new Error('Укажите причину брака');
  }

  if ((stopsCount > 0) !== (stopsDurationMinutes > 0)) {
    throw new Error('Количество остановок и длительность должны быть заданы вместе');
  }

  const factCategory = resolveFactCategory(line.product.category, parseFactCategory(input.factCategory));

  if (defectQuantity.greaterThan(0) && input.defectReasonId) {
    const reason = await deps.prisma.defectReason.findUnique({
      where: { id: input.defectReasonId },
    });
    if (!reason || !reason.active) {
      throw new Error('Причина брака не найдена или неактивна');
    }
  }

  const attributedRole = getAttributeRole(userRoles, 'production_order:report') ?? undefined;
  const now = new Date();

  const result = await deps.prisma.$transaction(async (tx) => {
    const fact = await tx.productionFact.create({
      data: {
        lineId,
        productId: line.productId,
        factCategory,
        quantity,
        defectQuantity,
        defectReasonId: input.defectReasonId ?? null,
        stopsCount,
        stopsDurationMinutes,
        recordedAt: now,
        reportedAt: now,
        reportedByUserId: session.userId,
        createdById: session.userId,
        postCompletionCorrection: false,
      },
    });

    const updatedLine = await tx.productionOrderLine.update({
      where: { id: lineId },
      data: { status: 'REPORTED' },
    });

    await deps.writeAudit(tx, {
      action: 'UPDATE',
      objectType: 'ProductionOrderLine',
      objectId: lineId,
      field: 'status',
      oldValue: 'ACCEPTED',
      newValue: 'REPORTED',
      userId: session.userId,
      userRoles,
      permission: 'production_order:report',
    });

    await deps.writeAudit(tx, {
      action: 'CREATE',
      objectType: 'ProductionFact',
      objectId: fact.id,
      newValue: JSON.stringify({
        lineId,
        productId: line.productId,
        factCategory,
        quantity: quantity.toString(),
        defectQuantity: defectQuantity.toString(),
        stopsCount,
        stopsDurationMinutes,
      }),
      userId: session.userId,
      userRoles,
      permission: 'production_order:report',
    });

    await deps.writeTiming(tx, {
      documentType: 'PRODUCTION_ORDER',
      documentId: line.order.id,
      entityType: 'LINE',
      entityId: lineId,
      fromStatus: 'ACCEPTED',
      toStatus: 'REPORTED',
      initiatorRole: attributedRole,
      initiatorId: session.userId,
    });

    const s1cUsers = await tx.user.findMany({
      where: {
        roles: {
          some: {
            role: { code: 'S1C' },
          },
        },
      },
      select: { id: true },
    });

    const recipientIds = s1cUsers.map((u) => u.id);
    if (recipientIds.length > 0) {
      await tx.notification.createMany({
        data: recipientIds.map((recipientId) => ({
          eventCode: 'EV_03' as const,
          recipientId,
          title: 'Оператор внёс итог смены',
          body: JSON.stringify({
            orderId: line.order.id,
            lineId,
            factId: fact.id,
            workCenterId: line.workCenterId,
            operatorId: line.operatorId,
          }),
          deepLink: '/production-orders/' + line.order.id,
        })),
      });
    }

    await checkAndCloseProductionOrder(line.order.id, tx, session);

    return { ...fact, line: updatedLine };
  });

  revalidatePath('/shift-execution');
  revalidatePath('/production-orders/' + line.order.id);
  return result as unknown as ProductionFact;
}

export async function reportProductionFactAction(lineId: string, formData: FormData): Promise<ReportFactResult> {
  try {
    const input: ReportFactInput = {
      quantity: Number(formData.get('quantity')),
      factCategory: parseFactCategory(formData.get('factCategory')),
      defectQuantity: formData.get('defectQuantity') ? Number(formData.get('defectQuantity')) : undefined,
      defectReasonId: formData.get('defectReasonId')?.toString() || undefined,
      stopsCount: formData.get('stopsCount') ? Number(formData.get('stopsCount')) : undefined,
      stopsDurationMinutes: formData.get('stopsDurationMinutes') ? Number(formData.get('stopsDurationMinutes')) : undefined,
    };

    await reportProductionFact(lineId, input);
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Не удалось внести итог';
    return { success: false, error: message };
  }
}

// TODO T-033: реализовать потребление факта
// TODO T-034: реализовать корректировку факта Оператором
