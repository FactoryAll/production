'use server';

import { revalidatePath } from 'next/cache';
import { Prisma } from '@prisma/client';
import type { GoodsTransfer, TransferLine, Warehouse, Product, StockCategory, StockMovementType } from '@prisma/client';
import { prisma, writeAudit, writeTiming, emitEvent } from '@prodtrack/db';
import { requirePermission } from '@/lib/auth/access';
import { getAttributeRole } from '@prodtrack/contracts';
import {
  applyStockMovements,
  buildTransferIssueMovements,
  buildTransferReturnMovements,
  buildTransferReceiptMovements,
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
  applyStockMovements?: typeof applyStockMovements;
  buildTransferIssueMovements?: typeof buildTransferIssueMovements;
  getStockBalance?: typeof getStockBalance;
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

export type ReceiveGoodsTransferResult =
  | { success: true; status: 'RECEIVED' | 'DISCREPANCY' }
  | { success: false; error: string };

export interface ReceiveLineInput {
  transferLineId: string;
  actualQuantity: number;
}

export interface ReceiveGoodsTransferDeps {
  prisma: typeof prisma;
  writeAudit: typeof writeAudit;
  writeTiming: typeof writeTiming;
  emitEvent: typeof emitEvent;
  requirePermission: typeof requirePermission;
  applyStockMovements: typeof applyStockMovements;
  buildTransferReceiptMovements: typeof buildTransferReceiptMovements;
}

export type ReconcileDiscrepanciesResult =
  | { success: true }
  | { success: false; error: string };

export interface ReconcileDiscrepancyInput {
  discrepancyId: string;
  reconciledQuantity: number;
}

export interface ReconcileDiscrepanciesDeps {
  prisma: typeof prisma;
  writeAudit: typeof writeAudit;
  writeTiming: typeof writeTiming;
  emitEvent: typeof emitEvent;
  requirePermission: typeof requirePermission;
  applyStockMovements: typeof applyStockMovements;
}

function toDecimal(value: number | string): Prisma.Decimal {
  return new Prisma.Decimal(value);
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

  const isDraft = transfer.status === 'DRAFT';
  const isSubmitted = transfer.status === 'SUBMITTED';
  if (!isDraft && !isSubmitted) {
    // BR-2: корректировка запрещена после подтверждения КСГП.
    throw new Error('Корректировка недоступна после подтверждения КСГП');
  }

  const { products, parsedLines } = await validateCreateInput(input, deps.prisma);

  const productNameById = new Map<string, string>();
  for (const line of transfer.lines) {
    productNameById.set(line.productId, line.product.name);
  }
  for (const product of products) {
    productNameById.set(product.id, product.name);
  }

  const oldByProduct = new Map(transfer.lines.map((line) => [line.productId, line.plannedQuantity]));
  const newByProduct = new Map(parsedLines.map((line) => [line.productId, line.plannedQuantity]));
  const sourceChanged = input.sourceWarehouseId !== transfer.sourceWarehouseId;

  const oldLines = transfer.lines.map((line) => ({
    productId: line.productId,
    plannedQuantity: line.plannedQuantity.toString(),
  }));
  const newLines = parsedLines.map((line) => ({
    productId: line.productId,
    plannedQuantity: line.plannedQuantity.toString(),
  }));

  // Списание уже произошло при отправке (Р-03), поэтому правка отправленного
  // Перемещения должна скорректировать остатки склада-источника и не превысить BR-1.
  const issueAdjustments: Array<{ productId: string; quantity: Prisma.Decimal }> = [];
  const returnAdjustments: Array<{ productId: string; quantity: Prisma.Decimal }> = [];

  if (isSubmitted) {
    if (sourceChanged) {
      for (const line of transfer.lines) {
        returnAdjustments.push({ productId: line.productId, quantity: line.plannedQuantity });
      }
      for (const line of parsedLines) {
        issueAdjustments.push({ productId: line.productId, quantity: line.plannedQuantity });
      }
    } else {
      for (const productId of new Set([...oldByProduct.keys(), ...newByProduct.keys()])) {
        const oldQuantity = oldByProduct.get(productId) ?? new Prisma.Decimal(0);
        const newQuantity = newByProduct.get(productId) ?? new Prisma.Decimal(0);
        const delta = newQuantity.minus(oldQuantity);
        if (delta.greaterThan(0)) {
          issueAdjustments.push({ productId, quantity: delta });
        } else if (delta.lessThan(0)) {
          returnAdjustments.push({ productId, quantity: delta.abs() });
        }
      }
    }

    const getBalance = deps.getStockBalance ?? getStockBalance;
    for (const adjustment of issueAdjustments) {
      const balances = await getBalance(deps.prisma, {
        warehouseType: 'PRODUCTION',
        productId: adjustment.productId,
        stockCategory: 'GP',
      });
      const balance = balances[0]?.quantity ?? new Prisma.Decimal(0);
      if (balance.lessThan(adjustment.quantity)) {
        throw new Error(
          `Недостаточно остатка для продукта ${productNameById.get(adjustment.productId) ?? ''}: требуется ${adjustment.quantity.toFixed(2)}, доступно ${balance.toFixed(2)}`,
        );
      }
    }
  }

  const productById = new Map(products.map((product) => [product.id, product]));

  const result = await deps.prisma.$transaction(async (tx) => {
    if (isSubmitted) {
      const applyMovements = deps.applyStockMovements ?? applyStockMovements;
      const buildIssue = deps.buildTransferIssueMovements ?? buildTransferIssueMovements;

      if (issueAdjustments.length > 0) {
        const issueLines = issueAdjustments.map((adjustment) => ({
          productId: adjustment.productId,
          quantity: adjustment.quantity.toNumber(),
          sourceId: transfer.id,
        }));
        const issueProducts = issueAdjustments.map((adjustment) => {
          const product = productById.get(adjustment.productId);
          return {
            id: adjustment.productId,
            category: product?.category ?? ('GP' as Product['category']),
            active: product?.active ?? true,
          };
        });
        await applyMovements(tx, buildIssue(input.sourceWarehouseId, issueLines, issueProducts));
      }

      if (returnAdjustments.length > 0) {
        // Возврат оформляется напрямую: продукт может быть деактивирован,
        // но по Р-22 остаётся применимым в незавершённых документах.
        const returnLines = returnAdjustments.map((adjustment) => ({
          warehouseId: transfer.sourceWarehouseId,
          productId: adjustment.productId,
          stockCategory: 'GP' as StockCategory,
          type: 'RETURN' as StockMovementType,
          quantity: adjustment.quantity,
          sourceType: 'TRANSFER_EDIT',
          sourceId: transfer.id,
        }));
        await applyMovements(tx, returnLines);
      }
    }

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

    if (isSubmitted && (issueAdjustments.length > 0 || returnAdjustments.length > 0)) {
      await deps.writeAudit(tx, {
        action: 'UPDATE',
        objectType: 'GoodsTransfer',
        objectId: transfer.id,
        field: 'stockAdjustment',
        oldValue: JSON.stringify(
          [...oldByProduct.entries()].map(([productId, quantity]) => ({
            productId,
            plannedQuantity: quantity.toString(),
          })),
        ),
        newValue: JSON.stringify({
          issued: issueAdjustments.map((a) => ({ productId: a.productId, quantity: a.quantity.toString() })),
          returned: returnAdjustments.map((a) => ({ productId: a.productId, quantity: a.quantity.toString() })),
        }),
        userId,
        userRoles: roles,
        permission: 'transfer:create',
      });
    }

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

export async function receiveGoodsTransfer(
  transferId: string,
  input: { lines: ReceiveLineInput[] },
  deps: ReceiveGoodsTransferDeps = {
    prisma,
    writeAudit,
    writeTiming,
    emitEvent,
    requirePermission,
    applyStockMovements,
    buildTransferReceiptMovements,
  },
): Promise<GoodsTransfer & { lines: TransferLine[] }> {
  const session = await deps.requirePermission('transfer:receive');
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

  const statusMessages: Record<GoodsTransfer['status'], string> = {
    DRAFT: 'Перемещение ещё не отправлено',
    SUBMITTED: '',
    RECEIVED: 'Перемещение уже принято',
    DISCREPANCY: 'Перемещение уже принято с расхождениями',
    RECONCILED: 'Расхождения уже согласованы',
    CANCELLED: 'Приёмка отменённого Перемещения невозможна',
  };
  if (transfer.status !== 'SUBMITTED') {
    throw new Error(statusMessages[transfer.status] ?? 'Перемещение можно принять только из статуса Отправлено');
  }

  const lineIds = new Set(transfer.lines.map((line) => line.id));
  const seenInputIds = new Set<string>();
  const actualByLineId = new Map<string, Prisma.Decimal>();

  for (const item of input.lines) {
    if (!lineIds.has(item.transferLineId)) {
      throw new Error('Строка не найдена в перемещении');
    }
    if (seenInputIds.has(item.transferLineId)) {
      throw new Error('Строка в приёмке не может повторяться');
    }
    seenInputIds.add(item.transferLineId);

    const actual = toDecimal(item.actualQuantity);
    if (actual.lessThan(0)) {
      throw new Error('Фактическое количество не может быть отрицательным');
    }
    actualByLineId.set(item.transferLineId, actual);
  }

  if (input.lines.length !== transfer.lines.length) {
    throw new Error('Укажите фактическое количество для всех строк');
  }

  const receivedLines = transfer.lines.map((line) => ({
    ...line,
    actualQuantity: actualByLineId.get(line.id) ?? line.plannedQuantity,
  }));

  const hasDiscrepancy = receivedLines.some((line) =>
    !line.actualQuantity.equals(line.plannedQuantity),
  );
  const nextStatus: 'RECEIVED' | 'DISCREPANCY' = hasDiscrepancy ? 'DISCREPANCY' : 'RECEIVED';

  const products = transfer.lines.map((line) => ({
    id: line.product.id,
    category: line.product.category,
    active: line.product.active,
  }));

  const receiptLines = receivedLines.map((line) => ({
    productId: line.productId,
    quantity: line.actualQuantity.toNumber(),
    sourceId: transfer.id,
  }));

  const now = new Date();

  const result = await deps.prisma.$transaction(async (tx) => {
    for (const line of receivedLines) {
      await tx.transferLine.update({
        where: { id: line.id },
        data: { actualQuantity: line.actualQuantity },
      });
    }

    const updated = await tx.goodsTransfer.update({
      where: { id: transferId },
      data: {
        status: nextStatus,
        updatedAt: now,
      },
      include: { lines: true },
    });

    if (hasDiscrepancy) {
      for (const line of receivedLines) {
        const difference = line.actualQuantity.minus(line.plannedQuantity);
        if (!difference.equals(0)) {
          await tx.discrepancy.create({
            data: {
              goodsTransferId: transfer.id,
              transferLineId: line.id,
              productId: line.productId,
              plannedQuantity: line.plannedQuantity,
              actualQuantity: line.actualQuantity,
              difference,
              reconciled: false,
            },
          });
        }
      }
    }

    const receiptMovements = deps.buildTransferReceiptMovements(
      transfer.destinationWarehouse.id,
      receiptLines,
      products,
    );
    await deps.applyStockMovements(tx, receiptMovements);

    await deps.writeAudit(tx, {
      action: 'UPDATE',
      objectType: 'GoodsTransfer',
      objectId: transfer.id,
      field: 'status',
      oldValue: 'SUBMITTED',
      newValue: nextStatus,
      userId,
      userRoles: roles,
      permission: 'transfer:receive',
    });

    await deps.writeTiming(tx, {
      documentType: 'GOODS_TRANSFER',
      documentId: transfer.id,
      entityType: 'DOCUMENT',
      entityId: transfer.id,
      fromStatus: 'SUBMITTED',
      toStatus: nextStatus,
      transitionedAt: now,
      initiatorRole: getAttributeRole(roles, 'transfer:receive') ?? undefined,
      initiatorId: userId,
    });

    const recipientRoleCodes: Array<'NP' | 'USGP'> = nextStatus === 'RECEIVED' ? ['NP'] : ['NP', 'USGP'];
    const notifyUsers = await tx.user.findMany({
      where: {
        roles: {
          some: {
            role: {
              code: { in: recipientRoleCodes },
            },
          },
        },
      },
      select: { id: true },
    });
    const recipientIds = notifyUsers.map((u) => u.id);

    if (recipientIds.length > 0) {
      const payload =
        nextStatus === 'RECEIVED'
          ? {
              transferId: transfer.id,
              sourceWarehouse: { id: transfer.sourceWarehouse.id, name: transfer.sourceWarehouse.name },
              destinationWarehouse: { id: transfer.destinationWarehouse.id, name: transfer.destinationWarehouse.name },
            }
          : {
              transferId: transfer.id,
              sourceWarehouse: { id: transfer.sourceWarehouse.id, name: transfer.sourceWarehouse.name },
              destinationWarehouse: { id: transfer.destinationWarehouse.id, name: transfer.destinationWarehouse.name },
              discrepanciesCount: receivedLines.filter((line) =>
                !line.actualQuantity.equals(line.plannedQuantity),
              ).length,
            };

      await deps.emitEvent(tx, {
        eventCode: nextStatus === 'RECEIVED' ? 'EV_05' : 'EV_06',
        title: nextStatus === 'RECEIVED' ? 'Перемещение принято без расхождений' : 'Перемещение принято с расхождениями',
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

export async function receiveGoodsTransferAction(
  transferId: string,
  formData: FormData,
): Promise<ReceiveGoodsTransferResult> {
  try {
    const linesRaw = formData.get('lines') as string;
    const lines: ReceiveLineInput[] = linesRaw ? JSON.parse(linesRaw) : [];

    const transfer = await receiveGoodsTransfer(transferId, { lines });
    return { success: true, status: transfer.status as 'RECEIVED' | 'DISCREPANCY' };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Не удалось принять перемещение';
    return { success: false, error: message };
  }
}

export async function reconcileDiscrepancies(
  transferId: string,
  input: { discrepancies: ReconcileDiscrepancyInput[] },
  deps: ReconcileDiscrepanciesDeps = {
    prisma,
    writeAudit,
    writeTiming,
    emitEvent,
    requirePermission,
    applyStockMovements,
  },
): Promise<GoodsTransfer & { lines: TransferLine[] }> {
  const session = await deps.requirePermission('transfer:reconcile');
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
          discrepancies: true,
        },
      },
    },
  });

  if (!transfer) {
    throw new Error('Перемещение не найдено');
  }

  if (transfer.status !== 'DISCREPANCY') {
    throw new Error('Согласование доступно только для Перемещения с расхождениями');
  }

  const openDiscrepancies = transfer.lines
    .flatMap((line) => line.discrepancies)
    .filter((d) => !d.reconciled);

  const discrepancyById = new Map(openDiscrepancies.map((d) => [d.id, d]));
  const seenInputIds = new Set<string>();
  const reconciledQuantityById = new Map<string, Prisma.Decimal>();

  for (const item of input.discrepancies) {
    const discrepancy = discrepancyById.get(item.discrepancyId);
    if (!discrepancy) {
      throw new Error('Расхождение не найдено в перемещении');
    }
    if (seenInputIds.has(item.discrepancyId)) {
      throw new Error('Расхождение в согласовании не может повторяться');
    }
    seenInputIds.add(item.discrepancyId);

    const reconciledQuantity = toDecimal(item.reconciledQuantity);
    if (reconciledQuantity.lessThan(0)) {
      throw new Error('Согласованное количество не может быть отрицательным');
    }
    reconciledQuantityById.set(item.discrepancyId, reconciledQuantity);
  }

  if (input.discrepancies.length !== openDiscrepancies.length) {
    throw new Error('Укажите согласованное количество для всех расхождений');
  }

  const lineById = new Map(transfer.lines.map((line) => [line.id, line]));
  const now = new Date();

  const result = await deps.prisma.$transaction(async (tx) => {
    for (const discrepancy of openDiscrepancies) {
      const reconciledQuantity = reconciledQuantityById.get(discrepancy.id)!;
      const line = lineById.get(discrepancy.transferLineId)!;

      await tx.discrepancy.update({
        where: { id: discrepancy.id },
        data: {
          reconciled: true,
          reconciledAt: now,
          reconciledByUserId: userId,
        },
      });

      const delta = reconciledQuantity.minus(discrepancy.actualQuantity);
      if (!delta.equals(0)) {
        const movement = {
          warehouseId: transfer.destinationWarehouse.id,
          productId: discrepancy.productId,
          stockCategory: 'GP' as const,
          type: delta.greaterThan(0) ? ('RECEIPT' as const) : ('ISSUE' as const),
          quantity: Math.abs(delta.toNumber()),
          sourceType: 'DISCREPANCY_RECONCILIATION',
          sourceId: transfer.id,
        };
        await deps.applyStockMovements(tx, [movement]);
      }

      await tx.transferLine.update({
        where: { id: line.id },
        data: { actualQuantity: reconciledQuantity },
      });
    }

    const updated = await tx.goodsTransfer.update({
      where: { id: transferId },
      data: {
        status: 'RECONCILED',
        updatedAt: now,
      },
      include: { lines: true },
    });

    await deps.writeAudit(tx, {
      action: 'UPDATE',
      objectType: 'GoodsTransfer',
      objectId: transfer.id,
      field: 'status',
      oldValue: 'DISCREPANCY',
      newValue: 'RECONCILED',
      userId,
      userRoles: roles,
      permission: 'transfer:reconcile',
    });

    await deps.writeTiming(tx, {
      documentType: 'GOODS_TRANSFER',
      documentId: transfer.id,
      entityType: 'DOCUMENT',
      entityId: transfer.id,
      fromStatus: 'DISCREPANCY',
      toStatus: 'RECONCILED',
      transitionedAt: now,
      initiatorRole: getAttributeRole(roles, 'transfer:reconcile') ?? undefined,
      initiatorId: userId,
    });

    const notifyUsers = await tx.user.findMany({
      where: {
        roles: {
          some: {
            role: {
              code: 'KSGP',
            },
          },
        },
      },
      select: { id: true },
    });
    const recipientIds = notifyUsers.map((u) => u.id);

    if (recipientIds.length > 0) {
      const payload = {
        transferId: transfer.id,
        discrepanciesCount: openDiscrepancies.length,
        reconciledByUserId: userId,
      };

      await deps.emitEvent(tx, {
        eventCode: 'EV_07',
        title: 'Расхождения согласованы',
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

export async function reconcileDiscrepanciesAction(
  transferId: string,
  formData: FormData,
): Promise<ReconcileDiscrepanciesResult> {
  try {
    const discrepanciesRaw = formData.get('discrepancies') as string;
    const discrepancies: ReconcileDiscrepancyInput[] = discrepanciesRaw ? JSON.parse(discrepanciesRaw) : [];

    await reconcileDiscrepancies(transferId, { discrepancies });
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Не удалось согласовать расхождения';
    return { success: false, error: message };
  }
}
