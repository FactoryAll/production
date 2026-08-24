'use server';

import { revalidatePath } from 'next/cache';
import type { ProductionOrderLine } from '@prisma/client';
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

export interface AcceptLineDeps {
  prisma: typeof prisma;
  writeAudit: typeof writeAudit;
  writeTiming: typeof writeTiming;
  requireShiftWindow: typeof requireShiftWindow;
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

// TODO T-032: реализовать ввод факта производства
