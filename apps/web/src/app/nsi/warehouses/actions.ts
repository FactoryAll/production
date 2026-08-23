'use server';

import { revalidatePath } from 'next/cache';
import { prisma, writeAudit } from '@prodtrack/db';
import { requirePermission } from '@/lib/auth/access';
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
  const { userId, user: userSession } = await requirePermission('nsi:manage');
  const roles = userSession.roles.map((ur) => ur.role.code);
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

        await writeAudit(tx, {
      action: 'UPDATE',
      objectType: 'Warehouse',
      objectId: updated.id,
      userId,
      userRoles: roles,
      permission: 'nsi:manage',
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
  const { userId, user: userSession } = await requirePermission('nsi:manage');
  const roles = userSession.roles.map((ur) => ur.role.code);

  const existing = await prisma.warehouse.findUniqueOrThrow({ where: { id } });
  const newActive = !existing.active;

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.warehouse.update({
      where: { id },
      data: { active: newActive },
    });

        await writeAudit(tx, {
      action: 'UPDATE',
      objectType: 'Warehouse',
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

  revalidatePath('/nsi/warehouses');
  return result;
}