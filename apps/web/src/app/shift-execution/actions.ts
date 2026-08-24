'use server';

import { revalidatePath } from 'next/cache';
import { Prisma, type ProductionOrderLine, type ProductionFact, type ProductCategory } from '@prisma/client';
import { prisma, writeAudit, writeTiming, type TxClient } from '@prodtrack/db';
import { requireShiftWindow } from '@/lib/auth/require-shift-window';
import { hasPermission, getAttributeRole } from '@prodtrack/contracts';
import {
  checkAndCloseProductionOrder,
  transitionToInProgress,
} from '@/lib/production-order-closing';
import { getAvailableBalance } from '@/lib/stock-preview';

export type AcceptLineResult =
  | { success: true }
  | { success: false; error: string };

export type ReportFactResult =
  | { success: true; warnings?: string[] }
  | { success: false; error: string };

export type CorrectFactResult =
  | { success: true; warnings?: string[] }
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
  getAvailableBalance: typeof getAvailableBalance;
}

export interface CorrectFactDeps extends ReportFactDeps {}

export type FactCategoryInput = 'MASS' | 'GP' | 'PF';

export interface ConsumptionInput {
  productId: string;
  quantity: number;
}

export interface ReportFactInput {
  quantity: number;
  factCategory: FactCategoryInput;
  defectQuantity?: number;
  defectReasonId?: string;
  stopsCount?: number;
  stopsDurationMinutes?: number;
  consumption?: ConsumptionInput[];
}

export interface CorrectFactInput extends ReportFactInput {}

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

function assertOperatorCorrectionAllowed(
  line: ProductionOrderLine & { order: { id: string; status: string } },
  userEmployeeId: string | null,
) {
  if (line.operatorId !== userEmployeeId) {
    throw new Error('Корректировать факт может только Оператор, назначенный на этот РЦ');
  }

  if (line.status !== 'REPORTED') {
    throw new Error('Факт ещё не внесён — используйте ввод факта');
  }

  if (line.order.status === 'COMPLETED') {
    throw new Error('После закрытия корректировка доступна только начальнику производства');
  }

  if (line.order.status !== 'CONFIRMED' && line.order.status !== 'IN_PROGRESS') {
    throw new Error('ПЗ отменено');
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

function parseConsumptionInput(raw: unknown): ConsumptionInput[] {
  if (!raw || (Array.isArray(raw) && raw.length === 0)) return [];
  if (!Array.isArray(raw)) {
    throw new Error('Некорректный формат потребления');
  }
  return raw.map((item) => {
    if (!item || typeof item !== 'object') {
      throw new Error('Некорректный формат строки потребления');
    }
    const productId = (item as Record<string, unknown>).productId;
    const quantity = Number((item as Record<string, unknown>).quantity);
    if (typeof productId !== 'string' || !productId) {
      throw new Error('Укажите продукт в строке потребления');
    }
    if (Number.isNaN(quantity) || quantity <= 0) {
      throw new Error('Количество потребления должно быть больше 0');
    }
    return { productId, quantity };
  });
}

async function validateReportLikeInput(
  input: ReportFactInput,
  deps: { prisma: typeof prisma; getAvailableBalance: typeof getAvailableBalance },
  line: ProductionOrderLine & { product: { category: ProductCategory }; workCenter: { producesMass: boolean } },
): Promise<{ factCategory: FactCategoryInput; quantity: Prisma.Decimal; defectQuantity: Prisma.Decimal; stopsCount: number; stopsDurationMinutes: number; consumption: ConsumptionInput[]; warnings: string[] }> {
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
  const consumption = parseConsumptionInput(input.consumption);

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

  const warnings: string[] = [];
  for (const item of consumption) {
    const balance = await deps.getAvailableBalance(item.productId, deps.prisma as unknown as TxClient);
    const diff = new Prisma.Decimal(item.quantity).minus(balance.available);
    if (diff.greaterThan(0)) {
      warnings.push(
        `Потребление ${item.productId} превышает остаток на ${diff.toFixed(2)} ${balance.unit}; записано с предупреждением`,
      );
    }
  }

  return { factCategory, quantity, defectQuantity, stopsCount, stopsDurationMinutes, consumption, warnings };
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
  deps: ReportFactDeps = {
    prisma,
    writeAudit,
    writeTiming,
    requireShiftWindow,
    getAvailableBalance,
  },
): Promise<{ fact: ProductionFact; warnings: string[] }> {
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
      workCenter: true,
    },
  });

  if (!line) {
    throw new Error('Строка ПЗ не найдена');
  }

  assertStatusTransitionAllowed(
    line as unknown as ProductionOrderLine & { order: { id: string; status: string } },
    session.user.employeeId,
  );

  const { factCategory, quantity, defectQuantity, stopsCount, stopsDurationMinutes, consumption, warnings } =
    await validateReportLikeInput(input, deps, line as unknown as ProductionOrderLine & { product: { category: ProductCategory }; workCenter: { producesMass: boolean } });

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

    if (consumption.length > 0) {
      await tx.factConsumption.createMany({
        data: consumption.map((item) => ({
          productionFactId: fact.id,
          productId: item.productId,
          quantity: new Prisma.Decimal(item.quantity),
        })),
      });
    }

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
        consumption,
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
  return { fact: result as unknown as ProductionFact, warnings };
}

export async function reportProductionFactAction(lineId: string, formData: FormData): Promise<ReportFactResult> {
  try {
    const rawConsumption = formData.get('consumption')?.toString();
    const input: ReportFactInput = {
      quantity: Number(formData.get('quantity')),
      factCategory: parseFactCategory(formData.get('factCategory')),
      defectQuantity: formData.get('defectQuantity') ? Number(formData.get('defectQuantity')) : undefined,
      defectReasonId: formData.get('defectReasonId')?.toString() || undefined,
      stopsCount: formData.get('stopsCount') ? Number(formData.get('stopsCount')) : undefined,
      stopsDurationMinutes: formData.get('stopsDurationMinutes') ? Number(formData.get('stopsDurationMinutes')) : undefined,
      consumption: rawConsumption ? JSON.parse(rawConsumption) : undefined,
    };

    const { warnings } = await reportProductionFact(lineId, input);
    return { success: true, warnings };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Не удалось внести итог';
    return { success: false, error: message };
  }
}

export type BalanceResult =
  | { success: true; balance: { available: number; unit: string } }
  | { success: false; error: string };

export async function getAvailableBalanceAction(productId: string): Promise<BalanceResult> {
  try {
    const session = await requireShiftWindow();
    const userRoles = session.user.roles.map((ur) => ur.role.code);

    if (!hasPermission(userRoles, 'production_order:report')) {
      return { success: false, error: 'Forbidden: insufficient permissions' };
    }

    const balance = await getAvailableBalance(productId);
    return { success: true, balance };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Не удалось получить остаток';
    return { success: false, error: message };
  }
}

export async function correctFactByOperator(
  lineId: string,
  input: CorrectFactInput,
  deps: CorrectFactDeps = {
    prisma,
    writeAudit,
    writeTiming,
    requireShiftWindow,
    getAvailableBalance,
  },
): Promise<{ fact: ProductionFact; warnings: string[] }> {
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
      workCenter: true,
      facts: {
        take: 1,
        include: {
          consumptions: true,
        },
      },
    },
  });

  if (!line) {
    throw new Error('Строка ПЗ не найдена');
  }

  assertOperatorCorrectionAllowed(
    line as unknown as ProductionOrderLine & { order: { id: string; status: string } },
    session.user.employeeId,
  );

  const existingFact = line.facts[0];
  if (!existingFact) {
    throw new Error('Факт ещё не внесён — используйте ввод факта');
  }

  const { factCategory, quantity, defectQuantity, stopsCount, stopsDurationMinutes, consumption, warnings } =
    await validateReportLikeInput(input, deps, line as unknown as ProductionOrderLine & { product: { category: ProductCategory }; workCenter: { producesMass: boolean } });

  const attributedRole = getAttributeRole(userRoles, 'production_order:report') ?? undefined;
  const now = new Date();

  const oldValue = JSON.stringify({
    factCategory: existingFact.factCategory,
    quantity: existingFact.quantity.toString(),
    defectQuantity: existingFact.defectQuantity.toString(),
    defectReasonId: existingFact.defectReasonId,
    stopsCount: existingFact.stopsCount,
    stopsDurationMinutes: existingFact.stopsDurationMinutes,
    consumption: existingFact.consumptions.map((c) => ({
      productId: c.productId,
      quantity: c.quantity.toString(),
    })),
  });

  const result = await deps.prisma.$transaction(async (tx) => {
    const fact = await tx.productionFact.update({
      where: { id: existingFact.id },
      data: {
        factCategory,
        quantity,
        defectQuantity,
        defectReasonId: input.defectReasonId ?? null,
        stopsCount,
        stopsDurationMinutes,
        recordedAt: now,
        postCompletionCorrection: false,
      },
    });

    await tx.factConsumption.deleteMany({
      where: { productionFactId: existingFact.id },
    });

    if (consumption.length > 0) {
      await tx.factConsumption.createMany({
        data: consumption.map((item) => ({
          productionFactId: existingFact.id,
          productId: item.productId,
          quantity: new Prisma.Decimal(item.quantity),
        })),
      });
    }

    const newValue = JSON.stringify({
      factCategory,
      quantity: quantity.toString(),
      defectQuantity: defectQuantity.toString(),
      defectReasonId: input.defectReasonId ?? null,
      stopsCount,
      stopsDurationMinutes,
      consumption,
    });

    await deps.writeAudit(tx, {
      action: 'UPDATE',
      objectType: 'ProductionFact',
      objectId: existingFact.id,
      field: 'fact',
      oldValue,
      newValue,
      userId: session.userId,
      userRoles,
      permission: 'production_order:report',
    });

    await deps.writeTiming(tx, {
      documentType: 'PRODUCTION_ORDER',
      documentId: line.order.id,
      entityType: 'LINE',
      entityId: lineId,
      fromStatus: 'REPORTED',
      toStatus: 'REPORTED',
      initiatorRole: attributedRole,
      initiatorId: session.userId,
    });

    return fact;
  });

  revalidatePath('/shift-execution');
  revalidatePath('/production-orders/' + line.order.id);
  return { fact: result, warnings };
}

export async function correctFactByOperatorAction(lineId: string, formData: FormData): Promise<CorrectFactResult> {
  try {
    const rawConsumption = formData.get('consumption')?.toString();
    const input: CorrectFactInput = {
      quantity: Number(formData.get('quantity')),
      factCategory: parseFactCategory(formData.get('factCategory')),
      defectQuantity: formData.get('defectQuantity') ? Number(formData.get('defectQuantity')) : undefined,
      defectReasonId: formData.get('defectReasonId')?.toString() || undefined,
      stopsCount: formData.get('stopsCount') ? Number(formData.get('stopsCount')) : undefined,
      stopsDurationMinutes: formData.get('stopsDurationMinutes') ? Number(formData.get('stopsDurationMinutes')) : undefined,
      consumption: rawConsumption ? JSON.parse(rawConsumption) : undefined,
    };

    const { warnings } = await correctFactByOperator(lineId, input);
    return { success: true, warnings };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Не удалось скорректировать факт';
    return { success: false, error: message };
  }
}

// TODO T-035: заменить getAvailableBalance на баланс-сервис поверх StockMovement
