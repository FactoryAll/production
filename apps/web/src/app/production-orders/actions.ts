'use server';

import { revalidatePath } from 'next/cache';
import type { ProductionOrder, ProductionOrderLine } from '@prisma/client';
import { prisma, writeAudit, writeTiming } from '@prodtrack/db';
import { requirePermission } from '@/lib/auth/access';
import {
  validateProductionOrder,
  parsePositiveDecimal,
  type ProductionOrderLineInput,
} from '@/lib/validation/production-order';

export type CreateProductionOrderResult =
  | { success: true; id: string }
  | { success: false; error: string };

export type ConfirmProductionOrderResult =
  | { success: true }
  | { success: false; error: string };

export interface CreateProductionOrderDeps {
  prisma: typeof prisma;
  writeAudit: typeof writeAudit;
  writeTiming: typeof writeTiming;
  requirePermission: typeof requirePermission;
}

// TODO T-026: использовать validateProductionOrder при корректировке ПЗ
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

export async function getProductionOrderById(id: string) {
  await requirePermission('production_order:read');

  return prisma.productionOrder.findUnique({
    where: { id },
    include: {
      shift: true,
      createdBy: { select: { id: true, login: true } },
      confirmedBy: { select: { id: true, login: true } },
      lines: {
        include: {
          workCenter: true,
          product: true,
          operator: true,
          workerAssignments: {
            include: {
              employee: true,
            },
          },
        },
      },
    },
  });
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

