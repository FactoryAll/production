'use server';

import { revalidatePath } from 'next/cache';
import { prisma, writeAudit } from '@prodtrack/db';
import { requireAdmin } from '@/lib/auth/require-admin';
import type { DefectReason } from '@prisma/client';

export interface DefectReasonInput {
  code: string;
  name: string;
}

function normalizeCode(code: string): string {
  return code.trim();
}

async function assertCodeUnique(code: string, excludeId?: string): Promise<void> {
  const normalized = normalizeCode(code);
  if (!normalized) {
    throw new Error('Код обязателен');
  }

  const existing = await prisma.defectReason.findUnique({
    where: { code: normalized },
  });

  if (existing && existing.id !== excludeId) {
    throw new Error('Причина брака с таким кодом уже существует');
  }
}

function assertInput(input: DefectReasonInput): void {
  if (!input.name.trim()) {
    throw new Error('Наименование обязательно');
  }
}

export async function createDefectReason(input: DefectReasonInput): Promise<DefectReason> {
  const { userId } = await requireAdmin();
  const normalizedCode = normalizeCode(input.code);
  await assertCodeUnique(normalizedCode);
  assertInput(input);

  const result = await prisma.$transaction(async (tx) => {
    const created = await tx.defectReason.create({
      data: {
        code: normalizedCode,
        name: input.name.trim(),
        active: true,
      },
    });

    // TODO T-021: роль определяется по типу действия (Р-23), сейчас захардкожено ADM
    await writeAudit(tx, {
      action: 'CREATE',
      objectType: 'DefectReason',
      objectId: created.id,
      userId,
      role: 'ADM',
      newValue: JSON.stringify({ code: created.code, name: created.name }),
    });

    return created;
  });

  revalidatePath('/nsi/defect-reasons');
  return result;
}

export async function updateDefectReason(id: string, input: DefectReasonInput): Promise<DefectReason> {
  const { userId } = await requireAdmin();
  const normalizedCode = normalizeCode(input.code);
  await assertCodeUnique(normalizedCode, id);
  assertInput(input);

  const existing = await prisma.defectReason.findUniqueOrThrow({ where: { id } });
  const oldValue = JSON.stringify({ code: existing.code, name: existing.name });

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.defectReason.update({
      where: { id },
      data: {
        code: normalizedCode,
        name: input.name.trim(),
      },
    });

    // TODO T-021: роль определяется по типу действия (Р-23), сейчас захардкожено ADM
    await writeAudit(tx, {
      action: 'UPDATE',
      objectType: 'DefectReason',
      objectId: updated.id,
      userId,
      role: 'ADM',
      field: 'code,name',
      oldValue,
      newValue: JSON.stringify({ code: updated.code, name: updated.name }),
    });

    return updated;
  });

  revalidatePath('/nsi/defect-reasons');
  return result;
}

export async function toggleDefectReasonActive(id: string): Promise<DefectReason> {
  const { userId } = await requireAdmin();

  const existing = await prisma.defectReason.findUniqueOrThrow({ where: { id } });
  const newActive = !existing.active;

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.defectReason.update({
      where: { id },
      data: { active: newActive },
    });

    // TODO T-021: роль определяется по типу действия (Р-23), сейчас захардкожено ADM
    await writeAudit(tx, {
      action: 'UPDATE',
      objectType: 'DefectReason',
      objectId: updated.id,
      userId,
      role: 'ADM',
      field: 'active',
      oldValue: String(existing.active),
      newValue: String(updated.active),
    });

    return updated;
  });

  revalidatePath('/nsi/defect-reasons');
  return result;
}
