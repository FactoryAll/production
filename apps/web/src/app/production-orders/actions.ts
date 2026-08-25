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
import { prisma, writeAudit, writeTiming, emitEvent } from '@prodtrack/db';
import { requirePermission } from '@/lib/auth/access';
import { getAttributeRole } from '@prodtrack/contracts';
import {
  applyStockMovements,
  buildProductionFactMovements,
  factCategoryToStockCategory,
} from '@/lib/stock-service';
import { updateShiftSummary } from '@/lib/shift-summary-service';
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
  updateShiftSummary?: typeof updateShiftSummary;
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
      const operatorUsers = await tx.user.findMany({
        where: { employeeId: { in: uniqueOperatorIds } },
        select: { id: true },
      });
      const operatorUserIds = operatorUsers.map((u) => u.id);

      if (operatorUserIds.length > 0) {
        const shiftName = 'Смена ' + order.shift.number;
        await tx.notification.createMany({
          data: operatorUserIds.map((recipientId) => ({
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
type SubstitutionFactCategory = 'MASS' | 'GP' | 'PF';

function isSubstitutionReasonCode(value: unknown): value is SubstitutionReasonCode {
  return typeof value === 'string' && SUBSTITUTION_REASON_CODES.includes(value as SubstitutionReasonCode);
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

function parseFactCategory(value: unknown): SubstitutionFactCategory {
  const v = String(value).toUpperCase();
  if (v === 'MASS' || v === 'GP' || v === 'PF') {
    return v;
  }
  throw new Error('Недопустимая категория факта');
}

function allowedCategoriesForProduct(productCategory: 'MASS' | 'GP' | 'PF'): SubstitutionFactCategory[] {
  if (productCategory === 'MASS') return ['MASS'];
  if (productCategory === 'GP') return ['GP', 'PF'];
  throw new Error('Неизвестная категория продукта');
}

function parseSubstitutionOutput(
  productCategory: 'MASS' | 'GP' | 'PF',
  outputByCategory: unknown,
  legacyQuantity: number | undefined,
  legacyFactCategory: SubstitutionFactCategory | undefined,
): Partial<Record<SubstitutionFactCategory, Prisma.Decimal>> {
  const allowed = allowedCategoriesForProduct(productCategory);
  const result: Partial<Record<SubstitutionFactCategory, Prisma.Decimal>> = {};

  // Legacy single-fact path: keep old callers/tests working.
  if (legacyFactCategory && allowed.includes(legacyFactCategory)) {
    result[legacyFactCategory] = parseNonNegativeDecimal(legacyQuantity);
  }

  if (outputByCategory && typeof outputByCategory === 'object') {
    for (const [key, value] of Object.entries(outputByCategory as Record<string, unknown>)) {
      const cat = parseFactCategory(key);
      if (!allowed.includes(cat)) {
        throw new Error(`Для данного продукта категория ${cat} недопустима`);
      }
      const qty = parseNonNegativeDecimal(value);
      if (qty.greaterThan(0)) {
        result[cat] = qty;
      }
    }
  }

  return result;
}

function parseSubstitutionConsumption(raw: unknown): { productId: string; quantity: number }[] {
  if (!raw || (Array.isArray(raw) && raw.length === 0)) return [];
  if (!Array.isArray(raw)) {
    throw new Error('Некорректный формат потребления');
  }
  return raw.map((item) => {
    if (!item || typeof item !== 'object') {
      throw new Error('Некорректный формат строки потребления');
    }
    const { productId, quantity } = item as Record<string, unknown>;
    if (!productId || typeof productId !== 'string') {
      throw new Error('Укажите продукт в потреблении');
    }
    const q = Number(quantity);
    if (Number.isNaN(q) || q <= 0) {
      throw new Error('Количество потребления должно быть больше 0');
    }
    return { productId, quantity: q };
  });
}

async function validateSubstitutionInput(
  input: SubstitutionInput,
  deps: { prisma: typeof prisma },
  line: ProductionOrderLine & { product: { category: 'MASS' | 'GP' | 'PF'; id: string }; workCenter: { producesMass: boolean }; operator: { id: string } | null },
): Promise<{ outputByCategory: Partial<Record<SubstitutionFactCategory, Prisma.Decimal>>; defectQuantity: Prisma.Decimal; stopsCount: number; stopsDurationMinutes: number; consumption: { productId: string; quantity: number }[] }> {
  const outputByCategory = parseSubstitutionOutput(
    line.product.category,
    input.outputByCategory,
    input.output,
    input.factCategory,
  );

  const totalOutput = Object.values(outputByCategory).reduce(
    (sum, q) => sum.plus(q ?? new Prisma.Decimal(0)),
    new Prisma.Decimal(0),
  );
  if (totalOutput.lessThanOrEqualTo(0)) {
    throw new Error('Укажите выпуск');
  }

  const defectQuantity = parseNonNegativeDecimal(input.defectQuantity);
  const stopsCount = parseNonNegativeInteger(input.stopsCount);
  const stopsDurationMinutes = parseNonNegativeInteger(input.stopsDurationMinutes);

  if (defectQuantity.greaterThan(0) && !input.defectReasonId) {
    throw new Error('Укажите причину брака');
  }

  if ((stopsCount > 0) !== (stopsDurationMinutes > 0)) {
    throw new Error('Количество остановок и длительность должны быть заданы вместе');
  }

  const consumption = parseSubstitutionConsumption(input.consumption);

  if (line.workCenter.producesMass && consumption.length > 0) {
    throw new Error('Потребление указывается только на ГП/ПФ-РЦ');
  }

  const seenProducts = new Set<string>();
  for (const item of consumption) {
    if (seenProducts.has(item.productId)) {
      throw new Error('Продукт в потреблении не может повторяться');
    }
    seenProducts.add(item.productId);

    const product = await deps.prisma.product.findUnique({
      where: { id: item.productId },
    });
    if (!product) {
      throw new Error('Продукт не найден');
    }
    if (!product.active) {
      throw new Error('Продукт неактивен');
    }
  }

  if (defectQuantity.greaterThan(0) && input.defectReasonId) {
    const reason = await deps.prisma.defectReason.findUnique({
      where: { id: input.defectReasonId },
    });
    if (!reason || !reason.active) {
      throw new Error('Причина брака не найдена или неактивна');
    }
  }

  return { outputByCategory, defectQuantity, stopsCount, stopsDurationMinutes, consumption };
}

async function findS1CUserIds(client: { user: { findMany: typeof prisma.user.findMany } }): Promise<string[]> {
  const users = await client.user.findMany({
    where: { roles: { some: { role: { code: 'S1C' } } } },
    select: { id: true },
  });
  return users.map((u: { id: string }) => u.id);
}

export interface SubstitutionInput {
  reasonCode: string;
  comment: string;
  /** @deprecated Use outputByCategory instead. */
  output?: number;
  /** @deprecated Use outputByCategory instead. */
  factCategory?: 'MASS' | 'GP' | 'PF';
  outputByCategory?: Partial<Record<'MASS' | 'GP' | 'PF', number>>;
  defectQuantity?: number;
  defectReasonId?: string;
  stopsCount?: number;
  stopsDurationMinutes?: number;
  consumption?: { productId: string; quantity: number }[];
}

export async function substituteOperator(
  lineId: string,
  input: SubstitutionInput,
  deps: CreateProductionOrderDeps = { prisma, writeAudit, writeTiming, requirePermission },
): Promise<void> {
  const session = await deps.requirePermission('production_order:confirm');
  const userId = session.userId;
  const roles = session.user.roles.map((ur) => ur.role.code);

  const line = await deps.prisma.productionOrderLine.findUnique({
    where: { id: lineId },
    include: { order: true, operator: true, product: true, workCenter: true },
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

  const { outputByCategory, defectQuantity, stopsCount, stopsDurationMinutes, consumption } =
    await validateSubstitutionInput(input, deps, line as unknown as ProductionOrderLine & { product: { category: 'MASS' | 'GP' | 'PF'; id: string }; workCenter: { producesMass: boolean }; operator: { id: string } | null });

  const operatorId = line.operatorId;
  const orderId = line.orderId;
  const oldStatus = line.status;

  const attributedRole = (() => {
    const match = roles.find((role) => role === 'NP' || role === 'ADM');
    return match ?? undefined;
  })();

  await deps.prisma.$transaction(async (tx) => {
    const productionWarehouse = await tx.warehouse.findFirstOrThrow({
      where: { type: 'PRODUCTION' },
    });

    const consumedProductIds = [...new Set(consumption.map((item) => item.productId))];
    const consumedProducts = consumedProductIds.length > 0
      ? await tx.product.findMany({
          where: { id: { in: consumedProductIds } },
          select: { id: true, category: true },
        })
      : [];
    const categoryById = new Map(consumedProducts.map((p) => [p.id, p.category]));

    const createdFacts: ProductionFact[] = [];
    const now = new Date();
    for (const [category, quantity] of Object.entries(outputByCategory) as ['MASS' | 'GP' | 'PF', Prisma.Decimal][]) {
      const fact = await tx.productionFact.upsert({
        where: { lineId_factCategory: { lineId, factCategory: category } },
        create: {
          lineId,
          productId: line.productId,
          factCategory: category,
          quantity,
          defectQuantity,
          defectReasonId: input.defectReasonId ?? null,
          stopsCount,
          stopsDurationMinutes,
          recordedAt: now,
          reportedAt: now,
          reportedByUserId: userId,
          createdById: userId,
          postCompletionCorrection: false,
          comment: reasonCode,
        },
        update: {
          quantity,
          defectQuantity,
          defectReasonId: input.defectReasonId ?? null,
          stopsCount,
          stopsDurationMinutes,
          recordedAt: now,
          reportedAt: now,
          reportedByUserId: userId,
          postCompletionCorrection: false,
          comment: reasonCode,
        },
      });
      createdFacts.push(fact as unknown as ProductionFact);

      if (consumption.length > 0) {
        await tx.factConsumption.createMany({
          data: consumption.map((item) => ({
            productionFactId: fact.id,
            productId: item.productId,
            quantity: new Prisma.Decimal(item.quantity),
          })),
        });
      }

      const movements = buildProductionFactMovements({
        factId: fact.id,
        productId: line.productId,
        factCategory: category,
        quantity,
        warehouseId: productionWarehouse.id,
        sourceType: 'PRODUCTION_FACT',
        consumption: consumption.map((item) => {
          const productCategory = categoryById.get(item.productId);
          if (!productCategory) {
            throw new Error('Продукт потребления не найден');
          }
          return {
            productId: item.productId,
            productCategory,
            quantity: new Prisma.Decimal(item.quantity),
          };
        }),
      });

      await (deps.applyStockMovements ?? applyStockMovements)(tx, movements);

      await deps.writeAudit(tx, {
        action: 'CREATE',
        objectType: 'ProductionFact',
        objectId: fact.id,
        newValue: JSON.stringify({
          lineId,
          productId: line.productId,
          factCategory: category,
          quantity: quantity.toString(),
          defectQuantity: defectQuantity.toString(),
          stopsCount,
          stopsDurationMinutes,
          consumption,
          reasonCode,
          comment,
        }),
        userId,
        userRoles: roles,
        permission: 'production_order:confirm',
      });
    }

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
      documentId: orderId,
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
      const operatorUser = await tx.user.findFirst({
        where: { employeeId: operatorId },
        select: { id: true },
      });
      if (operatorUser) {
        recipientIds.add(operatorUser.id);
      }
    }
    const s1cUserIds = await findS1CUserIds(tx as unknown as PrismaLike);
    for (const id of s1cUserIds) {
      recipientIds.add(id);
    }

    const uniqueRecipientIds = [...recipientIds];
    if (uniqueRecipientIds.length > 0) {
      await emitEvent(tx, {
        eventCode: 'EV_08',
        title: 'Смена закрыта за Оператора',
        body: JSON.stringify({
          orderId,
          lineId,
          operatorId,
          reasonCode,
          comment,
          factIds: createdFacts.map((f) => f.id),
        }),
        deepLink: '/production-orders/' + orderId,
        recipientIds: uniqueRecipientIds,
      });
    }

    if (s1cUserIds.length > 0) {
      await emitEvent(tx, {
        eventCode: 'EV_03',
        title: 'Итог смены внесён',
        body: JSON.stringify({ orderId, lineId, factIds: createdFacts.map((f) => f.id) }),
        deepLink: '/production-orders/' + orderId,
        recipientIds: s1cUserIds,
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
    const rawConsumption = formData.get('consumption')?.toString();
    const rawOutputByCategory = formData.get('outputByCategory')?.toString();
    const input: SubstitutionInput = {
      reasonCode,
      comment,
      defectQuantity: formData.get('defectQuantity') ? Number(formData.get('defectQuantity')) : undefined,
      defectReasonId: formData.get('defectReasonId')?.toString() || undefined,
      stopsCount: formData.get('stopsCount') ? Number(formData.get('stopsCount')) : undefined,
      stopsDurationMinutes: formData.get('stopsDurationMinutes') ? Number(formData.get('stopsDurationMinutes')) : undefined,
      consumption: rawConsumption ? JSON.parse(rawConsumption) : undefined,
    };

    if (rawOutputByCategory) {
      input.outputByCategory = JSON.parse(rawOutputByCategory);
    } else {
      input.output = Number(formData.get('output'));
      input.factCategory = formData.get('factCategory') as 'MASS' | 'GP' | 'PF';
    }

    await substituteOperator(lineId, input);
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
      const operatorUsers = await tx.user.findMany({
        where: { employeeId: { in: uniqueOperatorIds } },
        select: { id: true },
      });
      const operatorUserIds = operatorUsers.map((u) => u.id);

      if (operatorUserIds.length > 0) {
        await tx.notification.createMany({
          data: operatorUserIds.map((recipientId) => ({
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

    await (deps.updateShiftSummary ?? updateShiftSummary)(lineId, tx);

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

