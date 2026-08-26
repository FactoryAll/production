'use server';

import { revalidatePath } from 'next/cache';
import { Prisma } from '@prisma/client';
import type { GoodsTransfer, TransferLine, Warehouse, Product } from '@prisma/client';
import { prisma, writeAudit, writeTiming, emitEvent } from '@prodtrack/db';
import { requirePermission, requireAnyPermission } from '@/lib/auth/access';
import { getAttributeRole } from '@prodtrack/contracts';
import {
  applyStockMovements,
  buildTransferIssueMovements,
  buildTransferReturnMovements,
  getStockBalance,
} from '@/lib/stock-service';

export type CreateGoodsTransferResult =
  | { success: true; id: string }
  | { success: false; error: string };

export type SubmitGoodsTransferResult =
  | { success: true }
  | { success: false; error: string };

export type UpdateGoodsTransferResult =
  | { success: true }
  | { success: false; error: string };

export interface TransferLineInput {
  productId: string;
  plannedQuantity: number;
}

export interface CreateGoodsTransferDeps {
  prisma: typeof prisma;
  writeAudit: typeof writeAudit;
  requirePermission: typeof requirePermission;
}

export interface UpdateGoodsTransferDeps {
  prisma: typeof prisma;
  writeAudit: typeof writeAudit;
  requirePermission: typeof requirePermission;
}

export interface SubmitGoodsTransferDeps {
  prisma: typeof prisma;
  writeAudit: typeof writeAudit;
  writeTiming: typeof writeTiming;
  emitEvent: typeof emitEvent;
  requirePermission: typeof requirePermission;
  applyStockMovements: typeof applyStockMovements;
  buildTransferIssueMovements: typeof buildTransferIssueMovements;
  getStockBalance: typeof getStockBalance;
}

export type CancelGoodsTransferResult =
  | { success: true }
  | { success: false; error: string };

export interface CancelGoodsTransferDeps {
  prisma: typeof prisma;
  writeAudit: typeof writeAudit;
  writeTiming: typeof writeTiming;
  emitEvent: typeof emitEvent;
  requirePermission: typeof requirePermission;
  applyStockMovements: typeof applyStockMovements;
  buildTransferReturnMovements: typeof import('@/lib/stock-service').buildTransferReturnMovements;
}

function toDecimal(value: number | string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function transferStatusLabel(status: GoodsTransfer['status']): string {
  const labels: Record<GoodsTransfer['status'], string> = {
    DRAFT: 'Черновик',
    SUBMITTED: 'Отправлено',
    RECEIVED: 'Принято',
    DISCREPANCY: 'Расхождение',
    RECONCILED: 'Согласовано',
    CANCELLED: 'Отменено',
  };
  return labels[status] ?? status;
}

async function validateCreateInput(
  input: { sourceWarehouseId: string; destinationWarehouseId: string; lines: TransferLineInput[] },
  client: typeof prisma,
): Promise<{ warehouses: Warehouse[]; products: Product[]; parsedLines: { productId: string; plannedQuantity: Prisma.Decimal }[] }> {
  const { sourceWarehouseId, destinationWarehouseId, lines } = input;

  if (sourceWarehouseId === destinationWarehouseId) {
    throw new Error('Склад-источник и склад-приёмник должны различаться');
  }

  if (lines.length === 0) {
    throw new Error('Добавьте хотя бы одну строку перемещения');
  }

  const warehouses = await client.warehouse.findMany({
    where: {
      id: { in: [sourceWarehouseId, destinationWarehouseId] },
    },
  });

  const sourceWarehouse = warehouses.find((w) => w.id === sourceWarehouseId);
  const destinationWarehouse = warehouses.find((w) => w.id === destinationWarehouseId);

  if (!sourceWarehouse || !destinationWarehouse) {
    throw new Error('Склад не найден');
  }
  if (!sourceWarehouse.active || !destinationWarehouse.active) {
    throw new Error('Склад деактивирован');
  }

  const productIds = [...new Set(lines.map((line) => line.productId))];
  const products = await client.product.findMany({
    where: { id: { in: productIds } },
  });
  const productById = new Map(products.map((p) => [p.id, p]));

  const seenProducts = new Set<string>();
  const parsedLines: { productId: string; plannedQuantity: Prisma.Decimal }[] = [];

  for (const line of lines) {
    if (!line.productId) {
      throw new Error('Укажите продукт');
    }

    const quantity = toDecimal(line.plannedQuantity);
    if (quantity.lessThanOrEqualTo(0)) {
      throw new Error('Количество должно быть больше 0');
    }

    if (seenProducts.has(line.productId)) {
      throw new Error('Продукт в перемещении не может повторяться');
    }
    seenProducts.add(line.productId);

    const product = productById.get(line.productId);
    if (!product) {
      throw new Error('Продукт не найден');
    }
    if (!product.active) {
      throw new Error('Продукт деактивирован');
    }
    if (product.category !== 'GP') {
      throw new Error('Перемещения возможны только для ГП');
    }

    parsedLines.push({ productId: product.id, plannedQuantity: quantity });
  }

  return { warehouses, products, parsedLines };
}

export async function createGoodsTransfer(
  input: {
    sourceWarehouseId: string;
    destinationWarehouseId: string;
    lines: TransferLineInput[];
  },
  deps: CreateGoodsTransferDeps = { prisma, writeAudit, requirePermission },
): Promise<GoodsTransfer & { lines: TransferLine[] }> {
  const session = await deps.requirePermission('transfer:create');
  const userId = session.userId;
  const roles = session.user.roles.map((ur) => ur.role.code);

  const { parsedLines } = await validateCreateInput(input, deps.prisma);

  const result = await deps.prisma.$transaction(async (tx) => {
    const transfer = await tx.goodsTransfer.create({
      data: {
        status: 'DRAFT',
        sourceWarehouseId: input.sourceWarehouseId,
        destinationWarehouseId: input.destinationWarehouseId,
        lines: {
          create: parsedLines.map((line) => ({
            productId: line.productId,
            plannedQuantity: line.plannedQuantity,
          })),
        },
      },
      include: { lines: true },
    });

    await deps.writeAudit(tx, {
      action: 'CREATE',
      objectType: 'GoodsTransfer',
      objectId: transfer.id,
      field: 'transfer',
      newValue: JSON.stringify({
        id: transfer.id,
        status: transfer.status,
        sourceWarehouseId: transfer.sourceWarehouseId,
        destinationWarehouseId: transfer.destinationWarehouseId,
        lines: parsedLines.map((line) => ({
          productId: line.productId,
          plannedQuantity: line.plannedQuantity.toNumber(),
        })),
      }),
      userId,
      userRoles: roles,
      permission: 'transfer:create',
    });

    return transfer;
  });

  revalidatePath('/transfers');
  return result;
}

export async function createGoodsTransferAction(formData: FormData): Promise<CreateGoodsTransferResult> {
  try {
    const sourceWarehouseId = (formData.get('sourceWarehouseId') as string) ?? '';
    const destinationWarehouseId = (formData.get('destinationWarehouseId') as string) ?? '';
    const linesRaw = formData.get('lines') as string;
    const lines: TransferLineInput[] = linesRaw ? JSON.parse(linesRaw) : [];

    const transfer = await createGoodsTransfer({ sourceWarehouseId, destinationWarehouseId, lines });
    return { success: true, id: transfer.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Не удалось создать перемещение';
    return { success: false, error: message };
  }
}

export async function submitGoodsTransfer(
  transferId: string,
  deps: SubmitGoodsTransferDeps = {
    prisma,
    writeAudit,
    writeTiming,
    emitEvent,
    requirePermission,
    applyStockMovements,
    buildTransferIssueMovements,
    getStockBalance,
  },
): Promise<GoodsTransfer & { lines: TransferLine[] }> {
  const session = await deps.requirePermission('transfer:update');
  const userId = session.userId;
  const roles = session.user.roles.map((ur) => ur.role.code);

  const transfer = await deps.prisma.goodsTransfer.findUnique({
    where: { id: transferId },
    include: {
      sourceWarehouse: true,
      destinationWarehouse: true,
      lines: {
        include: {
          product: true,
        },
      },
    },
  });

  if (!transfer) {
    throw new Error('Перемещение не найдено');
  }

  if (transfer.status !== 'DRAFT') {
    throw new Error('Перемещение можно отправить только из статуса Черновик');
  }

  if (transfer.lines.length === 0) {
    throw new Error('Перемещение не содержит строк');
  }

  for (const line of transfer.lines) {
    if (!line.product.active) {
      throw new Error(`Продукт деактивирован: ${line.product.name}`);
    }
  }

  if (!transfer.sourceWarehouse.active || !transfer.destinationWarehouse.active) {
    throw new Error('Склад деактивирован');
  }

  for (const line of transfer.lines) {
    const balances = await deps.getStockBalance(deps.prisma, {
      warehouseType: 'PRODUCTION',
      productId: line.productId,
      stockCategory: 'GP',
    });

    const balance = balances[0]?.quantity ?? new Prisma.Decimal(0);
    if (balance.lessThan(line.plannedQuantity)) {
      throw new Error(
        `Недостаточно остатка для продукта ${line.product.name}: требуется ${line.plannedQuantity.toFixed(2)}, доступно ${balance.toFixed(2)}`,
      );
    }
  }

  const products = transfer.lines.map((line) => ({
    id: line.product.id,
    category: line.product.category,
    active: line.product.active,
  }));

  const movementLines = transfer.lines.map((line) => ({
    productId: line.productId,
    quantity: line.plannedQuantity.toNumber(),
    sourceId: transfer.id,
  }));

  const now = new Date();

  const result = await deps.prisma.$transaction(async (tx) => {
    const updated = await tx.goodsTransfer.update({
      where: { id: transferId },
      data: {
        status: 'SUBMITTED',
        submittedAt: now,
        submittedByUserId: userId,
      },
      include: { lines: true },
    });

    const movements = deps.buildTransferIssueMovements(transfer.sourceWarehouse.id, movementLines, products);
    await deps.applyStockMovements(tx, movements);

    await deps.writeAudit(tx, {
      action: 'UPDATE',
      objectType: 'GoodsTransfer',
      objectId: transfer.id,
      field: 'status',
      oldValue: 'DRAFT',
      newValue: 'SUBMITTED',
      userId,
      userRoles: roles,
      permission: 'transfer:update',
    });

    await deps.writeTiming(tx, {
      documentType: 'GOODS_TRANSFER',
      documentId: transfer.id,
      entityType: 'DOCUMENT',
      entityId: transfer.id,
      fromStatus: 'DRAFT',
      toStatus: 'SUBMITTED',
      transitionedAt: now,
      initiatorRole: getAttributeRole(roles, 'transfer:update') ?? undefined,
      initiatorId: userId,
    });

    const ksgpUsers = await tx.user.findMany({
      where: { roles: { some: { role: { code: 'KSGP' } } } },
      select: { id: true },
    });
    const recipientIds = ksgpUsers.map((u) => u.id);

    if (recipientIds.length > 0) {
      const payload = {
        transferId: transfer.id,
        sourceWarehouse: { id: transfer.sourceWarehouse.id, name: transfer.sourceWarehouse.name },
        destinationWarehouse: { id: transfer.destinationWarehouse.id, name: transfer.destinationWarehouse.name },
        linesCount: transfer.lines.length,
      };

      await deps.emitEvent(tx, {
        eventCode: 'EV_04',
        title: 'Перемещение отправлено',
        body: JSON.stringify(payload),
        deepLink: '/transfers/' + transfer.id,
        payload,
        recipientIds,
      });
    }

    return updated;
  });

  revalidatePath('/transfers');
  revalidatePath('/transfers/' + transferId);
  return result;
}

export async function submitGoodsTransferAction(transferId: string): Promise<SubmitGoodsTransferResult> {
  try {
    await submitGoodsTransfer(transferId);
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Не удалось отправить перемещение';
    return { success: false, error: message };
  }
}

export async function cancelGoodsTransfer(
  transferId: string,
  deps: CancelGoodsTransferDeps = {
    prisma,
    writeAudit,
    writeTiming,
    emitEvent,
    requirePermission,
    applyStockMovements,
    buildTransferReturnMovements,
  },
): Promise<GoodsTransfer & { lines: TransferLine[] }> {
  const session = await deps.requirePermission('transfer:update');
  const userId = session.userId;
  const roles = session.user.roles.map((ur) => ur.role.code);

  const transfer = await deps.prisma.goodsTransfer.findUnique({
    where: { id: transferId },
    include: {
      sourceWarehouse: true,
      destinationWarehouse: true,
      lines: {
        include: {
          product: true,
        },
      },
    },
  });

  if (!transfer) {
    throw new Error('Перемещение не найдено');
  }

  if (transfer.status !== 'DRAFT' && transfer.status !== 'SUBMITTED') {
    throw new Error('Перемещение нельзя отменить в этом статусе');
  }

  const oldStatus = transfer.status;
  const now = new Date();

  const result = await deps.prisma.$transaction(async (tx) => {
    if (oldStatus === 'SUBMITTED') {
      for (const line of transfer.lines) {
        if (!line.product.active) {
          throw new Error(`Продукт деактивирован: ${line.product.name}`);
        }
      }

      if (!transfer.sourceWarehouse.active || !transfer.destinationWarehouse.active) {
        throw new Error('Склад деактивирован');
      }

      const products = transfer.lines.map((line) => ({
        id: line.product.id,
        category: line.product.category,
        active: line.product.active,
      }));

      const movementLines = transfer.lines.map((line) => ({
        productId: line.productId,
        quantity: line.plannedQuantity.toNumber(),
        sourceId: transfer.id,
      }));

      const returnMovements = deps.buildTransferReturnMovements(
        transfer.sourceWarehouse.id,
        movementLines,
        products,
      );
      await deps.applyStockMovements(tx, returnMovements);
    }

    const updated = await tx.goodsTransfer.update({
      where: { id: transferId },
      data: {
        status: 'CANCELLED',
        updatedAt: now,
      },
      include: { lines: true },
    });

    await deps.writeAudit(tx, {
      action: 'UPDATE',
      objectType: 'GoodsTransfer',
      objectId: transfer.id,
      field: 'status',
      oldValue: oldStatus,
      newValue: 'CANCELLED',
      userId,
      userRoles: roles,
      permission: 'transfer:update',
    });

    await deps.writeTiming(tx, {
      documentType: 'GOODS_TRANSFER',
      documentId: transfer.id,
      entityType: 'DOCUMENT',
      entityId: transfer.id,
      fromStatus: oldStatus,
      toStatus: 'CANCELLED',
      transitionedAt: now,
      initiatorRole: getAttributeRole(roles, 'transfer:update') ?? undefined,
      initiatorId: userId,
    });

    const npAndKsgpUsers = await tx.user.findMany({
      where: {
        roles: {
          some: {
            role: {
              code: { in: ['NP', 'KSGP'] },
            },
          },
        },
      },
      select: { id: true, roles: { select: { role: { select: { code: true } } } } },
    });

    const recipientIds = npAndKsgpUsers.map((u) => u.id);

    if (recipientIds.length > 0) {
      const payload = {
        transferId: transfer.id,
        sourceWarehouse: { id: transfer.sourceWarehouse.id, name: transfer.sourceWarehouse.name },
        destinationWarehouse: { id: transfer.destinationWarehouse.id, name: transfer.destinationWarehouse.name },
        status: 'CANCELLED',
      };

      await deps.emitEvent(tx, {
        eventCode: 'EV_10',
        title: 'Перемещение отменено',
        body: JSON.stringify(payload),
        deepLink: '/transfers/' + transfer.id,
        payload,
        recipientIds,
      });
    }

    return updated;
  });

  revalidatePath('/transfers');
  revalidatePath('/transfers/' + transferId);
  return result;
}

export async function cancelGoodsTransferAction(transferId: string): Promise<CancelGoodsTransferResult> {
  try {
    await cancelGoodsTransfer(transferId);
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Не удалось отменить перемещение';
    return { success: false, error: message };
  }
}

export async function updateGoodsTransfer(
  transferId: string,
  input: {
    sourceWarehouseId: string;
    destinationWarehouseId: string;
    lines: TransferLineInput[];
  },
  deps: UpdateGoodsTransferDeps = { prisma, writeAudit, requirePermission },
): Promise<GoodsTransfer & { lines: TransferLine[] }> {
  const session = await deps.requirePermission('transfer:create');
  const userId = session.userId;
  const roles = session.user.roles.map((ur) => ur.role.code);

  const transfer = await deps.prisma.goodsTransfer.findUnique({
    where: { id: transferId },
    include: { lines: { include: { product: true } } },
  });

  if (!transfer) {
    throw new Error('Перемещение не найдено');
  }
  if (transfer.status !== 'DRAFT') {
    throw new Error('Редактирование доступно только в статусе Черновик');
  }

  const { parsedLines } = await validateCreateInput(input, deps.prisma);

  const oldLines = transfer.lines.map((line) => ({
    productId: line.productId,
    plannedQuantity: line.plannedQuantity.toString(),
  }));
  const newLines = parsedLines.map((line) => ({
    productId: line.productId,
    plannedQuantity: line.plannedQuantity.toString(),
  }));

  const result = await deps.prisma.$transaction(async (tx) => {
    await tx.goodsTransfer.update({
      where: { id: transferId },
      data: {
        sourceWarehouseId: input.sourceWarehouseId,
        destinationWarehouseId: input.destinationWarehouseId,
        updatedAt: new Date(),
      },
    });

    await tx.transferLine.deleteMany({ where: { goodsTransferId: transferId } });

    await tx.transferLine.createMany({
      data: parsedLines.map((line) => ({
        goodsTransferId: transferId,
        productId: line.productId,
        plannedQuantity: line.plannedQuantity,
      })),
    });

    const updated = await tx.goodsTransfer.findUnique({
      where: { id: transferId },
      include: { lines: true },
    });

    if (!updated) {
      throw new Error('Перемещение не найдено после редактирования');
    }

    await deps.writeAudit(tx, {
      action: 'UPDATE',
      objectType: 'GoodsTransfer',
      objectId: transfer.id,
      field: 'lines',
      oldValue: JSON.stringify(oldLines),
      newValue: JSON.stringify(newLines),
      userId,
      userRoles: roles,
      permission: 'transfer:create',
    });

    return updated;
  });

  revalidatePath('/transfers');
  revalidatePath('/transfers/' + transferId);
  return result;
}

export async function updateGoodsTransferAction(
  transferId: string,
  formData: FormData,
): Promise<UpdateGoodsTransferResult> {
  try {
    const sourceWarehouseId = (formData.get('sourceWarehouseId') as string) ?? '';
    const destinationWarehouseId = (formData.get('destinationWarehouseId') as string) ?? '';
    const linesRaw = formData.get('lines') as string;
    const lines: TransferLineInput[] = linesRaw ? JSON.parse(linesRaw) : [];

    await updateGoodsTransfer(transferId, { sourceWarehouseId, destinationWarehouseId, lines });
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Не удалось изменить перемещение';
    return { success: false, error: message };
  }
}

export async function getTransfers() {
  await requireAnyPermission([
    'transfer:create',
    'transfer:update',
    'transfer:receive',
    'transfer:reconcile',
  ]);

  return prisma.goodsTransfer.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      sourceWarehouse: true,
      destinationWarehouse: true,
      lines: {
        include: {
          product: true,
        },
      },
    },
  });
}

export async function getTransferById(id: string) {
  await requireAnyPermission([
    'transfer:create',
    'transfer:update',
    'transfer:receive',
    'transfer:reconcile',
  ]);

  return prisma.goodsTransfer.findUnique({
    where: { id },
    include: {
      sourceWarehouse: true,
      destinationWarehouse: true,
      submittedBy: { select: { id: true, login: true } },
      lines: {
        include: {
          product: true,
        },
      },
    },
  });
}

export async function getTransferCreateData() {
  await requirePermission('transfer:create');

  const [warehouses, products] = await Promise.all([
    prisma.warehouse.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.product.findMany({ where: { active: true, category: 'GP' }, orderBy: { code: 'asc' } }),
  ]);

  return { warehouses, products };
}

export { transferStatusLabel };

// TODO T-041: реализовать приёмку (RECEIVED/DISCREPANCY)
