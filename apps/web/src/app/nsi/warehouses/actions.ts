'use server';

// TODO T-017: заменить requireAdmin на центральную матрицу доступа (T-017)
import { revalidatePath } from 'next/cache';
import { prisma, writeAudit } from '@prodtrack/db';
import { requireAdmin } from '@/lib/auth/require-admin';
import type { Warehouse } from '@prisma/client';

export interface WarehouseInput {
  name: string;
  description?: string;
}

function assertInput(input: WarehouseInput): void {
  if (!input.name.trim()) {
    throw new Error('Название обязательно');
  }
}

export async function updateWarehouse(id: string, input: WarehouseInput): Promise<Warehouse> {
  const { userId } = await requireAdmin();
  assertInput(input);

  const existing = await prisma.warehouse.findUniqueOrThrow({ where: { id } });
  const oldValue = JSON.stringify({
    name: existing.name,
    description: existing.description,
  });

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.warehouse.update({
      where: { id },
      data: {
        name: input.name.trim(),
        description: input.description?.trim() ?? null,
      },
    });

    // TODO T-021: роль определяется по типу действия (Р-23), сейчас захардкожено ADM
    await writeAudit(tx, {
      action: 'UPDATE',
      objectType: 'Warehouse',
      objectId: updated.id,
      userId,
      role: 'ADM',
      field: 'name,description',
      oldValue,
      newValue: JSON.stringify({
        name: updated.name,
        description: updated.description,
      }),
    });

    return updated;
  });

  revalidatePath('/nsi/warehouses');
  return result;
}

export async function toggleWarehouseActive(id: string): Promise<Warehouse> {
  const { userId } = await requireAdmin();

  const existing = await prisma.warehouse.findUniqueOrThrow({ where: { id } });
  const newActive = !existing.active;

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.warehouse.update({
      where: { id },
      data: { active: newActive },
    });

    // TODO T-021: полноценная атрибуция роли в аудите (Р-23), сейчас захардкожено ADM
    await writeAudit(tx, {
      action: 'UPDATE',
      objectType: 'Warehouse',
      objectId: updated.id,
      userId,
      role: 'ADM',
      field: 'active',
      oldValue: String(existing.active),
      newValue: String(updated.active),
    });

    return updated;
  });

  revalidatePath('/nsi/warehouses');
  return result;
}
