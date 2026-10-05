import { type Prisma, type PrismaClient, type ProductionOrderStatus } from '@prisma/client';
import { writeAudit, writeTiming, type TxClient } from '@prodtrack/db';
import { buildShiftSummary } from '@/lib/shift-summary-service';
import { syncProductionOrderTask } from '@/lib/onec/tasks';
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

/**
 * Закрывает ПЗ, когда все строки отчитались.
 *
 * `permission` — право действия, которым вызван переход: по нему M13 BR-X атрибутирует
 * роль в аудите (для внесения итога Оператором это `production_order:report`,
 * для ввода за Оператора — `production_order:confirm`). Право нельзя задавать
 * константой: у Оператора нет `production_order:confirm`, и атрибуция падала.
 */
export async function checkAndCloseProductionOrder(
  orderId: string,
  prisma: PrismaClient | TxClient,
  session: SessionWithUser,
  permission: PermissionCode,
  /**
   * Формирование задачи для 1С (T-050, UC-M12-1). Передаётся параметром, чтобы тесты
   * не зависели от модуля M12; по умолчанию — боевая синхронизация в той же транзакции.
   */
  syncTask: (
    tx: Prisma.TransactionClient,
    orderId: string,
  ) => Promise<unknown> = syncProductionOrderTask,
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

  if (!allReported) {
    return { closed: false, status };
  }

  const allAcceptedOrReported = order.lines.every((line) => line.status === 'ACCEPTED' || line.status === 'REPORTED');
  if (!allAcceptedOrReported) {
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
    permission,
  });

  await buildShiftSummary(orderId, prisma as PrismaClient);

  // M12 (T-050): итог смены сформирован → задача типа PRODUCTION для рабочего места С1С.
  await syncTask(prisma as Prisma.TransactionClient, orderId);

  return { closed: true, status: updated.status };
}

/** Переводит ПЗ в IN_PROGRESS после подтверждения получения Оператором. */
export async function transitionToInProgress(
  orderId: string,
  prisma: PrismaClient | TxClient,
  session: SessionWithUser,
  permission: PermissionCode,
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
    permission,
  });

  return { transitioned: true };
}
