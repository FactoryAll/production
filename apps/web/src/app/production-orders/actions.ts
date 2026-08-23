'use server';

import { revalidatePath } from 'next/cache';
import { Prisma } from '@prisma/client';
import type { ProductionOrder, ProductionOrderLine } from '@prisma/client';
import { prisma, writeAudit, writeTiming } from '@prodtrack/db';
import { requirePermission } from '@/lib/auth/access';
const Decimal = Prisma.Decimal;

export interface ProductionOrderLineInput {
  workCenterId: string;
  productId: string;
  plannedQuantity: number | string | Prisma.Decimal;
  operatorId: string;
  workerIds?: string[];
}

export type CreateProductionOrderResult =
  | { success: true; id: string }
  | { success: false; error: string };

const ERRORS = {
  NO_SHIFT: 'Не выбрана смена',
  NO_LINES: 'Добавьте хотя бы одну строку ПЗ',
  LINE_INCOMPLETE: 'Заполните РЦ, номенклатуру, количество и Оператора',
  INVALID_QUANTITY: 'Плановое количество должно быть больше 0',
  WORK_CENTER_DUPLICATE: 'РЦ может встречаться в ПЗ только один раз',
  BR7_MASS_ON_GP: 'Массу можно планировать только на РЦ 01/02',
  BR7_GP_ON_MASS: 'ГП можно планировать только на РЦ 03–12',
  OPERATOR_REQUIRED: 'Оператор обязателен для каждой строки',
} as const;

function parsePositiveDecimal(raw: unknown): Prisma.Decimal {
  const value = raw as Prisma.Decimal.Value;
  if (value instanceof Decimal) {
    if (value.lessThanOrEqualTo(0)) {
      throw new Error(ERRORS.INVALID_QUANTITY);
    }
    return value;
  }

  const str = typeof value === 'string' ? value.trim() : String(value);
  if (!str) {
    throw new Error(ERRORS.INVALID_QUANTITY);
  }

  const normalized = str.replace(',', '.');
  const num = Number(normalized);
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error(ERRORS.INVALID_QUANTITY);
  }

  return new Decimal(num);
}

export interface CreateProductionOrderDeps {
  prisma: typeof prisma;
  writeAudit: typeof writeAudit;
  writeTiming: typeof writeTiming;
  requirePermission: typeof requirePermission;
}

export async function createProductionOrder(
  input: { shiftId: string; lines: ProductionOrderLineInput[] },
  deps: CreateProductionOrderDeps = { prisma, writeAudit, writeTiming, requirePermission },
): Promise<ProductionOrder & { lines: ProductionOrderLine[] }> {
  const session = await deps.requirePermission('production_order:create');
  const userId = session.userId;
  const roles = session.user.roles.map((ur) => ur.role.code);

  const shift = await deps.prisma.shift.findUnique({
    where: { id: input.shiftId },
  });
  if (!shift) {
    throw new Error(ERRORS.NO_SHIFT);
  }

  if (!input.lines.length) {
    throw new Error(ERRORS.NO_LINES);
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

  const seenWorkCenters = new Set<string>();

  const parsedLines = input.lines.map((line, index) => {
    const row = index + 1;
    const workCenter = workCenterById.get(line.workCenterId);
    const product = productById.get(line.productId);
    const operator = line.operatorId ? employeeById.get(line.operatorId) : undefined;

    if (!workCenter || !product || !line.operatorId || !operator) {
      throw new Error(ERRORS.LINE_INCOMPLETE + ' (строка ' + row + ')');
    }

    const quantity = parsePositiveDecimal(line.plannedQuantity);

    if (workCenter.producesMass && product.category !== 'MASS') {
      throw new Error(ERRORS.BR7_MASS_ON_GP + ' (строка ' + row + ')');
    }
    if (!workCenter.producesMass && product.category !== 'GP') {
      throw new Error(ERRORS.BR7_GP_ON_MASS + ' (строка ' + row + ')');
    }

    if (seenWorkCenters.has(workCenter.id)) {
      throw new Error(ERRORS.WORK_CENTER_DUPLICATE + ': ' + workCenter.name);
    }
    seenWorkCenters.add(workCenter.id);

    return {
      workCenterId: workCenter.id,
      productId: product.id,
      plannedQuantity: quantity,
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
