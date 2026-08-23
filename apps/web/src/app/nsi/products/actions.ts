'use server';

import { revalidatePath } from 'next/cache';
import { prisma, writeAudit, type DeactivationWarning, getDeactivationWarnings as getDeactivationWarningsFromDb } from '@prodtrack/db';
import { requirePermission } from '@/lib/auth/access';
import { ProductCategory } from '@prodtrack/contracts';
import type { Product } from '@prisma/client';

export interface ProductInput {
  code: string;
  name: string;
  category: ProductCategory;
  unit: string;
}

const VALID_CATEGORIES = Object.values(ProductCategory);

function normalizeCode(code: string): string {
  return code.trim();
}

async function assertCodeUnique(code: string, excludeId?: string): Promise<void> {
  const normalized = normalizeCode(code);
  if (!normalized) {
    throw new Error('Код обязателен');
  }

  const existing = await prisma.product.findUnique({
    where: { code: normalized },
  });

  if (existing && existing.id !== excludeId) {
    throw new Error('Номенклатура с таким кодом уже существует');
  }
}

function assertCategory(category: ProductCategory): void {
  if (!VALID_CATEGORIES.includes(category)) {
    throw new Error('Категория может быть только Масса или ГП');
  }
}

function assertInput(input: ProductInput): void {
  if (!input.name.trim()) {
    throw new Error('Наименование обязательно');
  }
  if (!input.unit.trim()) {
    throw new Error('Единица измерения обязательна');
  }
  if (input.unit.trim().length > 20) {
    throw new Error('Единица измерения не может превышать 20 символов');
  }
}

export async function createProduct(input: ProductInput): Promise<Product> {
  const { userId, user: userSession } = await requirePermission('nsi:manage');
  const roles = userSession.roles.map((ur) => ur.role.code);
  const normalizedCode = normalizeCode(input.code);
  await assertCodeUnique(normalizedCode);
  assertCategory(input.category);
  assertInput(input);

  const result = await prisma.$transaction(async (tx) => {
    const created = await tx.product.create({
      data: {
        code: normalizedCode,
        name: input.name.trim(),
        category: input.category,
        unit: input.unit.trim(),
        active: true,
      },
    });

        await writeAudit(tx, {
      action: 'CREATE',
      objectType: 'Product',
      objectId: created.id,
      userId,
      userRoles: roles,
      permission: 'nsi:manage',
      newValue: JSON.stringify({
        code: created.code,
        name: created.name,
        category: created.category,
        unit: created.unit,
      }),
    });

    return created;
  });

  revalidatePath('/nsi/products');
  return result;
}

export async function updateProduct(id: string, input: ProductInput): Promise<Product> {
  const { userId, user: userSession } = await requirePermission('nsi:manage');
  const roles = userSession.roles.map((ur) => ur.role.code);
  const normalizedCode = normalizeCode(input.code);
  await assertCodeUnique(normalizedCode, id);
  assertCategory(input.category);
  assertInput(input);

  const existing = await prisma.product.findUniqueOrThrow({ where: { id } });
  const oldValue = JSON.stringify({
    code: existing.code,
    name: existing.name,
    category: existing.category,
    unit: existing.unit,
  });

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.product.update({
      where: { id },
      data: {
        code: normalizedCode,
        name: input.name.trim(),
        category: input.category,
        unit: input.unit.trim(),
      },
    });

        await writeAudit(tx, {
      action: 'UPDATE',
      objectType: 'Product',
      objectId: updated.id,
      userId,
      userRoles: roles,
      permission: 'nsi:manage',
      field: 'code,name,category,unit',
      oldValue,
      newValue: JSON.stringify({
        code: updated.code,
        name: updated.name,
        category: updated.category,
        unit: updated.unit,
      }),
    });

    return updated;
  });

  revalidatePath('/nsi/products');
  return result;
}

// TODO Фаза 2/3: заменить заглушку на реальный запрос незавершённых документов (UC-M01-2, Р-22)
export async function getDeactivationWarnings(id: string): Promise<DeactivationWarning[]> {
  await requirePermission('nsi:manage');
  return getDeactivationWarningsFromDb('Product', id);
}

export async function toggleProductActive(id: string): Promise<Product> {
  const { userId, user: userSession } = await requirePermission('nsi:manage');
  const roles = userSession.roles.map((ur) => ur.role.code);

  const existing = await prisma.product.findUniqueOrThrow({ where: { id } });
  const newActive = !existing.active;

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.product.update({
      where: { id },
      data: { active: newActive },
    });

        await writeAudit(tx, {
      action: 'UPDATE',
      objectType: 'Product',
      objectId: updated.id,
      userId,
      userRoles: roles,
      permission: 'nsi:manage',
      field: 'active',
      oldValue: String(existing.active),
      newValue: String(updated.active),
    });

    return updated;
  });

  revalidatePath('/nsi/products');
  return result;
}