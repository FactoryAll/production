import { type Prisma, type PrismaClient, type ProductionOrderStatus } from '@prisma/client';
import { writeAudit, writeTiming, type TxClient } from '@prodtrack/db';
import { buildShiftSummary } from '@/lib/shift-summary-service';
import { syncProductionOrderTask } from '@/lib/onec/tasks';
import { getAttributeRole, type PermissionCode, type RoleCode } from '@prodtrack/contracts';
import type { SessionWithUser } from '@/lib/auth/session-token';

const EDITABLE_BEFORE_CLOSED: ProductionOrderStatus[] = ['CONFIRMED', 'IN_PROGRESS'];

/** Статусы, из которых начальник производства закрывает ПЗ (14.11.2026). */
const CLOSABLE: ProductionOrderStatus[] = ['IN_PROGRESS', 'READY_FOR_CLOSE'];

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
): Promise<{ closed: boolean; status: ProductionOrderStatus; readyForClose: boolean }> {
  const order = await prisma.productionOrder.findUnique({
    where: { id: orderId },
    include: { lines: true },
  });

  if (!order) {
    throw new Error('ПЗ не найдено');
  }

  const status = getOrderStatus(order);
  if (!EDITABLE_BEFORE_CLOSED.includes(status)) {
    return { closed: false, status, readyForClose: false };
  }

  const totalLines = order.lines.length;
  if (totalLines === 0) {
    return { closed: false, status, readyForClose: false };
  }

  // 19.11.2026: отменённая строка (РЦ сломался, НП отменил задание) тоже «решена» —
  // иначе одно поломанное РЦ держало бы всё ПЗ и закрыть его было бы нечем.
  const allResolved = order.lines.every(
    (line) => line.status === 'REPORTED' || line.status === 'CANCELLED',
  );
  if (!allResolved) {
    return { closed: false, status, readyForClose: false };
  }

  // 14.11.2026, решение владельца по фидбэку НП: ПЗ больше НЕ закрывается само.
  // Все РЦ отчитались → видимый статус «Ожидает закрытия НП»; закрывает НП своей командой
  // (`closeProductionOrderByNP`), и только тогда формируется итог смены, задача для 1С
  // и уведомление специалистам.
  if (status === 'IN_PROGRESS') {
    await prisma.productionOrder.update({
      where: { id: orderId },
      data: { status: 'READY_FOR_CLOSE' },
    });

    // 17.11.2026: переход обязан оставлять след в аудите и хронометраже — как любой другой
    // переход статуса. Без этого в «Истории» ПЗ было видно «В работе», а статус на экране
    // уже «Ожидает закрытия НП»: журнал врал о состоянии документа.
    await writeStatusTransition({
      tx: prisma,
      order,
      session,
      newStatus: 'READY_FOR_CLOSE',
      permission,
    });
  }

  return { closed: false, status: 'READY_FOR_CLOSE', readyForClose: status === 'IN_PROGRESS' };
}

/**
 * Закрытие ПЗ начальником производства (14.11.2026).
 *
 * Проверяет, что все строки отчитаны, закрывает ПЗ, формирует итог смены и только здесь
 * ставит задачу для 1С. Право — то же, что у подтверждения ПЗ (`production_order:confirm`).
 */
export async function closeProductionOrderByNP(
  orderId: string,
  prisma: PrismaClient | TxClient,
  session: SessionWithUser,
  permission: PermissionCode,
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
  if (!CLOSABLE.includes(status)) {
    throw new Error('ПЗ уже закрыто или отменено');
  }

  if (
    order.lines.length === 0 ||
    !order.lines.every((line) => line.status === 'REPORTED' || line.status === 'CANCELLED')
  ) {
    throw new Error('Закрыть ПЗ можно только когда все РЦ внесли итоги или их задания отменены');
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

  // Только здесь: итог смены сформирован → задача для рабочего места С1С (M12, T-050).
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
