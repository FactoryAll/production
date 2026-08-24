import { type PrismaClient, type ProductionOrderStatus } from '@prisma/client';
import { writeAudit, writeTiming, type TxClient } from '@prodtrack/db';
import { buildShiftSummary } from '@/lib/shift-summary-service';
import { getAttributeRole, type PermissionCode, type RoleCode } from '@prodtrack/contracts';
import type { SessionWithUser } from '@/lib/auth/session-token';

const EDITABLE_BEFORE_CLOSED: ProductionOrderStatus[] = ['CONFIRMED', 'IN_PROGRESS'];

function getOrderStatus(prismaOrder: { status: ProductionOrderStatus }) {
  return prismaOrder.status;
}

function userRolesFromSession(session: SessionWithUser): RoleCode[] {
  return session.user.roles.map((ur) => ur.role.code as RoleCode);
}

function attributePermission(session: SessionWithUser, permission: PermissionCode): string | null {
  const roles = userRolesFromSession(session);
  return getAttributeRole(roles, permission);
}

interface ClosingContext {
  tx: TxClient;
  order: { id: string; status: ProductionOrderStatus };
  session: SessionWithUser;
  newStatus: ProductionOrderStatus;
  permission: PermissionCode;
}

async function writeStatusTransition(ctx: ClosingContext) {
  const roles = userRolesFromSession(ctx.session);
  const attributedRole = attributePermission(ctx.session, ctx.permission) ?? undefined;

  await writeAudit(ctx.tx, {
    action: 'UPDATE',
    objectType: 'ProductionOrder',
    objectId: ctx.order.id,
    field: 'status',
    oldValue: ctx.order.status,
    newValue: ctx.newStatus,
    userId: ctx.session.userId,
    userRoles: roles,
    permission: ctx.permission,
  });

  await writeTiming(ctx.tx, {
    documentType: 'PRODUCTION_ORDER',
    documentId: ctx.order.id,
    entityType: 'DOCUMENT',
    entityId: ctx.order.id,
    fromStatus: ctx.order.status,
    toStatus: ctx.newStatus,
    initiatorRole: attributedRole,
    initiatorId: ctx.session.userId,
  });
}

export async function checkAndCloseProductionOrder(
  orderId: string,
  prisma: PrismaClient | TxClient,
  session: SessionWithUser,
): Promise<{ closed: boolean; status: ProductionOrderStatus }> {
  const order = await prisma.productionOrder.findUnique({
    where: { id: orderId },
    include: { lines: true },
  });

  if (!order) {
    throw new Error('ПЗ не найдено');
  }

  const status = getOrderStatus(order);
  if (!EDITABLE_BEFORE_CLOSED.includes(status)) {
    return { closed: false, status };
  }

  const totalLines = order.lines.length;
  if (totalLines === 0) {
    return { closed: false, status };
  }

  const allReported = order.lines.every((line) => line.status === 'REPORTED');

  let shouldClose = false;
  if (totalLines === 1) {
    shouldClose = allReported;
  } else {
    const allAccepted = order.lines.every((line) => line.status === 'ACCEPTED' || line.status === 'REPORTED');
    shouldClose = allAccepted && allReported;
  }

  if (!shouldClose) {
    return { closed: false, status };
  }

  const updated = await prisma.productionOrder.update({
    where: { id: orderId },
    data: { status: 'COMPLETED', completedAt: new Date() },
  });

  await writeStatusTransition({
    tx: prisma,
    order,
    session,
    newStatus: 'COMPLETED',
    permission: 'production_order:confirm',
  });

  await buildShiftSummary(orderId, prisma as PrismaClient);

  return { closed: true, status: updated.status };
}

export async function transitionToInProgress(
  orderId: string,
  prisma: PrismaClient | TxClient,
  session: SessionWithUser,
): Promise<{ transitioned: boolean }> {
  const order = await prisma.productionOrder.findUnique({
    where: { id: orderId },
    include: { lines: true },
  });

  if (!order) {
    throw new Error('ПЗ не найдено');
  }

  if (order.status !== 'CONFIRMED') {
    return { transitioned: false };
  }

  const hasAccepted = order.lines.some((line) => line.status === 'ACCEPTED' || line.status === 'REPORTED');
  if (!hasAccepted) {
    return { transitioned: false };
  }

  await prisma.productionOrder.update({
    where: { id: orderId },
    data: { status: 'IN_PROGRESS' },
  });

  await writeStatusTransition({
    tx: prisma,
    order,
    session,
    newStatus: 'IN_PROGRESS',
    permission: 'production_order:confirm',
  });

  return { transitioned: true };
}
