'use server';

import { revalidatePath } from 'next/cache';
import { Prisma } from '@prisma/client';
import { prisma, writeAudit } from '@prodtrack/db';
import { hasPermission } from '@prodtrack/contracts';
import { requirePermission } from '@/lib/auth/access';
import {
  applyStockMovements,
  assertEnoughStock,
  type NewMovement,
} from '@/lib/stock-service';
import {
  STOCK_ADJUSTMENT_MAX_QUANTITY,
  STOCK_ADJUSTMENT_REASON_MIN_LENGTH,
  STOCK_ADJUSTMENT_REASON_OPTIONS,
  stockAdjustmentNumber,
  type StockAdjustmentReasonCode,
} from '@/lib/stock-adjustment';

/**
 * Документ корректировки остатков (M05, решение владельца 18.11.2026).
 *
 * Что он делает и чего не делает:
 * - **добавляет** компенсирующее движение (приход или списание) с источником
 *   `STOCK_ADJUSTMENT`; историю движений не правит — журнал остаётся append-only (M05 §4.2);
 * - создаётся только НП и АДМ (право `stock:adjust`), причина обязательна;
 * - уведомлений не отправляет никому, в том числе 1С (решение владельца 18.11.2026:
 *   событие `EV-13` «Скорректирован остаток» — отдельным решением позже);
 * - документ неизменяем: ошибка исправляется встречным документом со ссылкой на исходный.
 *
 * Постановка — `docs/stock_correction_design.md`.
 */

export interface StockAdjustmentLineInput {
  warehouseId: string;
  productId: string;
  stockCategory: 'MASS' | 'PF' | 'GP';
  direction: 'RECEIPT' | 'ISSUE';
  quantity: number;
}

export interface CreateStockAdjustmentInput {
  reasonCode: StockAdjustmentReasonCode;
  reason: string;
  basisDocument?: string;
  /** Исходная корректировка, которую исправляет эта (встречный документ). */
  compensatesAdjustmentId?: string;
  lines: StockAdjustmentLineInput[];
}

export interface CreateStockAdjustmentDeps {
  prisma: typeof prisma;
  writeAudit: typeof writeAudit;
  requirePermission: typeof requirePermission;
  applyStockMovements?: typeof applyStockMovements;
  /** Источник времени: тесты подменяют, чтобы номер и журнал были предсказуемы. */
  now?: () => Date;
}

export type CreateStockAdjustmentResult =
  | { success: true; id: string; number: string }
  | { success: false; error: string };

function assertReason(input: CreateStockAdjustmentInput): void {
  if (!STOCK_ADJUSTMENT_REASON_OPTIONS.some((option) => option.value === input.reasonCode)) {
    throw new Error('Выберите причину корректировки');
  }
  const reason = input.reason.trim();
  if (reason.length < STOCK_ADJUSTMENT_REASON_MIN_LENGTH) {
    throw new Error(
      `Причина обязательна: не короче ${STOCK_ADJUSTMENT_REASON_MIN_LENGTH} символов — по ней потом видно, что произошло`,
    );
  }
}

function assertLines(input: CreateStockAdjustmentInput): StockAdjustmentLineInput[] {
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new Error('Добавьте хотя бы одну позицию корректировки');
  }

  const seen = new Set<string>();
  const prepared: StockAdjustmentLineInput[] = [];
  for (const line of input.lines) {
    if (!line.warehouseId || !line.productId) {
      throw new Error('В строке не указан склад или номенклатура');
    }
    if (line.direction !== 'RECEIPT' && line.direction !== 'ISSUE') {
      throw new Error('Направление корректировки должно быть приходом или списанием');
    }
    if (line.stockCategory !== 'MASS' && line.stockCategory !== 'PF' && line.stockCategory !== 'GP') {
      throw new Error('Не указана категория остатка');
    }
    const quantity = Number(line.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error('Количество в строке должно быть больше нуля');
    }
    if (!Number.isInteger(quantity)) {
      throw new Error('Количество указывается целым числом');
    }
    if (quantity > STOCK_ADJUSTMENT_MAX_QUANTITY) {
      throw new Error(
        `Количество в строке не может быть больше ${STOCK_ADJUSTMENT_MAX_QUANTITY} — проверьте, не лишний ли ноль`,
      );
    }

    // Одна позиция — одна строка: две строки на ту же тройку спорили бы за остаток
    // и порядок их применения решал бы результат.
    const key = `${line.warehouseId}:${line.productId}:${line.stockCategory}`;
    if (seen.has(key)) {
      throw new Error('Позиция повторяется: в документе она должна быть одной строкой');
    }
    seen.add(key);

    prepared.push({ ...line, quantity });
  }
  return prepared;
}

/**
 * Создаёт документ корректировки. Вызывается из серверного действия и напрямую из тестов.
 */
export async function createStockAdjustment(
  input: CreateStockAdjustmentInput,
  deps: CreateStockAdjustmentDeps = { prisma, writeAudit, requirePermission },
): Promise<{ id: string; number: string }> {
  const session = await deps.requirePermission('stock:adjust');
  const userId = session.userId;
  const roles = session.user.roles.map((ur) => ur.role.code);

  // Требование владельца: только НП и АДМ. Проверяем и здесь, а не только на экране:
  // право могло остаться у роли из старого сида.
  if (!hasPermission(roles, 'stock:adjust')) {
    throw new Error('Forbidden: insufficient permissions');
  }

  assertReason(input);
  const lines = assertLines(input);
  const now = deps.now ? deps.now() : new Date();
  const applyMovements = deps.applyStockMovements ?? applyStockMovements;

  const warehouses = await deps.prisma.warehouse.findMany({
    where: { id: { in: [...new Set(lines.map((line) => line.warehouseId))] } },
    select: { id: true, type: true, name: true },
  });
  const warehouseById = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse]));

  const products = await deps.prisma.product.findMany({
    where: { id: { in: [...new Set(lines.map((line) => line.productId))] } },
    select: { id: true, code: true, name: true, unit: true, active: true },
  });
  const productById = new Map(products.map((product) => [product.id, product]));

  const balances = await deps.prisma.stockBalance.findMany({
    where: { productId: { in: [...new Set(lines.map((line) => line.productId))] } },
    select: { warehouseId: true, productId: true, stockCategory: true, quantity: true },
  });
  const balanceKeys = new Map(
    balances.map((balance) => [
      `${balance.warehouseId}:${balance.productId}:${balance.stockCategory}`,
      balance.quantity,
    ]),
  );

  for (const line of lines) {
    const warehouse = warehouseById.get(line.warehouseId);
    if (!warehouse) {
      throw new Error('Склад не найден');
    }
    const product = productById.get(line.productId);
    if (!product) {
      throw new Error('Номенклатура не найдена');
    }
    if (!product.active) {
      throw new Error(`Номенклатура «${product.name}» деактивирована`);
    }
    // BR-1/BR-2 модуля M05: склад ГП хранит только ГП, Производственный — Массу, ПФ и ГП.
    if (warehouse.type !== 'PRODUCTION' && line.stockCategory !== 'GP') {
      throw new Error('На складе ГП хранится только готовая продукция');
    }
    // BR-2 постановки: списание не уводит остаток ниже нуля — тем же правилом, что стоит
    // на потреблении. Остаток считается по тройке «склад + номенклатура + категория».
    if (line.direction === 'ISSUE') {
      const stored = balanceKeys.get(`${line.warehouseId}:${line.productId}:${line.stockCategory}`);
      const balance = stored === undefined ? new Prisma.Decimal(0) : new Prisma.Decimal(stored);
      // Для списания «доступно» — это то, что реально лежит: с отрицательного остатка
      // списывать нечем, сначала нужен приход.
      assertEnoughStock(
        balance.greaterThan(0) ? balance : new Prisma.Decimal(0),
        product.unit,
        line.quantity,
      );
    }
  }

  const result = await deps.prisma.$transaction(async (tx) => {
    // Номер из последовательности, а не MAX(number)+1: два НП, сохранившие корректировку
    // в одну секунду, иначе получили бы один номер.
    const [{ nextval }] = await tx.$queryRaw<Array<{ nextval: bigint }>>`
      SELECT nextval('stock_adjustment_number_seq') AS nextval
    `;
    const number = stockAdjustmentNumber(now.getFullYear(), nextval);

    const adjustment = await tx.stockAdjustment.create({
      data: {
        number,
        reasonCode: input.reasonCode,
        reason: input.reason.trim(),
        basisDocument: input.basisDocument?.trim() || null,
        createdAt: now,
        createdById: userId,
        compensatesAdjustmentId: input.compensatesAdjustmentId ?? null,
        lines: {
          create: lines.map((line) => ({
            warehouseId: line.warehouseId,
            productId: line.productId,
            stockCategory: line.stockCategory,
            direction: line.direction,
            quantity: new Prisma.Decimal(line.quantity),
          })),
        },
      },
      include: { lines: true },
    });

    const movements: NewMovement[] = lines.map((line) => ({
      warehouseId: line.warehouseId,
      productId: line.productId,
      stockCategory: line.stockCategory,
      type: line.direction === 'RECEIPT' ? 'RECEIPT' : 'ISSUE',
      quantity: new Prisma.Decimal(line.quantity),
      sourceType: 'STOCK_ADJUSTMENT',
      sourceId: adjustment.id,
    }));
    await applyMovements(tx, movements);

    // Аудит: одна запись на строку, «было → стало» — чтобы по журналу было видно,
    // из какого минуса получился ноль.
    for (const line of lines) {
      const product = productById.get(line.productId);
      const storedBefore = balanceKeys.get(
        `${line.warehouseId}:${line.productId}:${line.stockCategory}`,
      );
      const before = storedBefore === undefined ? new Prisma.Decimal(0) : new Prisma.Decimal(storedBefore);
      const delta = new Prisma.Decimal(line.quantity).times(line.direction === 'RECEIPT' ? 1 : -1);
      const after = before.plus(delta);
      await deps.writeAudit(tx, {
        action: 'CREATE',
        objectType: 'StockAdjustment',
        objectId: adjustment.id,
        field: 'quantity',
        oldValue: JSON.stringify({
          warehouseId: line.warehouseId,
          productId: line.productId,
          stockCategory: line.stockCategory,
          quantity: before.toString(),
        }),
        newValue: JSON.stringify({
          number,
          reasonCode: input.reasonCode,
          reason: input.reason.trim(),
          basisDocument: input.basisDocument?.trim() || null,
          compensatesAdjustmentId: input.compensatesAdjustmentId ?? null,
          warehouseId: line.warehouseId,
          productCode: product?.code ?? null,
          productName: product?.name ?? null,
          stockCategory: line.stockCategory,
          direction: line.direction,
          quantity: String(line.quantity),
          balanceAfter: after.toString(),
        }),
        userId,
        userRoles: roles,
        permission: 'stock:adjust',
      });
    }

    return adjustment;
  });

  revalidatePath('/stock');
  revalidatePath('/stock/adjustments');
  revalidatePath('/dashboard');
  return { id: result.id, number: result.number };
}

/** Обёртка для формы: превращает исключение в читаемый отказ, а не в «Application error». */
export async function createStockAdjustmentAction(
  formData: FormData,
): Promise<CreateStockAdjustmentResult> {
  try {
    const rawLines = formData.get('lines')?.toString();
    if (!rawLines) {
      return { success: false, error: 'Добавьте хотя бы одну позицию корректировки' };
    }
    const lines = JSON.parse(rawLines) as StockAdjustmentLineInput[];
    const created = await createStockAdjustment({
      reasonCode: formData.get('reasonCode')?.toString() as StockAdjustmentReasonCode,
      reason: formData.get('reason')?.toString() ?? '',
      basisDocument: formData.get('basisDocument')?.toString() || undefined,
      compensatesAdjustmentId: formData.get('compensatesAdjustmentId')?.toString() || undefined,
      lines,
    });
    return { success: true, id: created.id, number: created.number };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Не удалось сохранить корректировку';
    return { success: false, error: message };
  }
}
