'use server';

import { revalidatePath } from 'next/cache';
import { prisma, writeAudit, type DeactivationWarning, getDeactivationWarnings as getDeactivationWarningsFromDb } from '@prodtrack/db';
import { requirePermission } from '@/lib/auth/access';
import type { WorkCenter } from '@prisma/client';

function producesMassByCode(code: string): boolean {
  return code === '01' || code === '02';
}

export interface WorkCenterInput {
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

  const existing = await prisma.workCenter.findUnique({
    where: { code: normalized },
  });

  if (existing && existing.id !== excludeId) {
    throw new Error('РЦ с таким кодом уже существует');
  }
}

export async function createWorkCenter(input: WorkCenterInput): Promise<WorkCenter> {
  const { userId } = await requirePermission('nsi:manage');
  const normalizedCode = normalizeCode(input.code);
  await assertCodeUnique(normalizedCode);

  if (!input.name.trim()) {
    throw new Error('Наименование обязательно');
  }

  const result = await prisma.$transaction(async (tx) => {
    const created = await tx.workCenter.create({
      data: {
        code: normalizedCode,
        name: input.name.trim(),
        producesMass: producesMassByCode(normalizedCode),
        active: true,
      },
    });

    // TODO T-021: роль определяется по типу действия (Р-23), сейчас захардкожено ADM
    await writeAudit(tx, {
      action: 'CREATE',
      objectType: 'WorkCenter',
      objectId: created.id,
      userId,
      role: 'ADM',
      newValue: JSON.stringify({ code: created.code, name: created.name, producesMass: created.producesMass }),
    });

    return created;
  });

  revalidatePath('/nsi/work-centers');
  return result;
}

export async function updateWorkCenter(id: string, input: WorkCenterInput): Promise<WorkCenter> {
  const { userId } = await requirePermission('nsi:manage');
  const normalizedCode = normalizeCode(input.code);
  await assertCodeUnique(normalizedCode, id);

  if (!input.name.trim()) {
    throw new Error('Наименование обязательно');
  }

  const existing = await prisma.workCenter.findUniqueOrThrow({ where: { id } });
  const oldValue = JSON.stringify({ code: existing.code, name: existing.name, producesMass: existing.producesMass });

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.workCenter.update({
      where: { id },
      data: {
        code: normalizedCode,
        name: input.name.trim(),
        producesMass: producesMassByCode(normalizedCode),
      },
    });

    // TODO T-021: роль определяется по типу действия (Р-23), сейчас захардкожено ADM
    await writeAudit(tx, {
      action: 'UPDATE',
      objectType: 'WorkCenter',
      objectId: updated.id,
      userId,
      role: 'ADM',
      field: 'code,name,producesMass',
      oldValue,
      newValue: JSON.stringify({ code: updated.code, name: updated.name, producesMass: updated.producesMass }),
    });

    return updated;
  });

  revalidatePath('/nsi/work-centers');
  return result;
}

// TODO Фаза 2/3: заменить заглушку на реальный запрос незавершённых документов (UC-M01-2, Р-22)
export async function getDeactivationWarnings(id: string): Promise<DeactivationWarning[]> {
  await requirePermission('nsi:manage');
  return getDeactivationWarningsFromDb('WorkCenter', id);
}

export async function toggleWorkCenterActive(id: string): Promise<WorkCenter> {
  const { userId } = await requirePermission('nsi:manage');

  const existing = await prisma.workCenter.findUniqueOrThrow({ where: { id } });
  const newActive = !existing.active;

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.workCenter.update({
      where: { id },
      data: { active: newActive },
    });

    // TODO T-021: полноценная атрибуция роли в аудите (Р-23), сейчас захардкожено ADM
    await writeAudit(tx, {
      action: 'UPDATE',
      objectType: 'WorkCenter',
      objectId: updated.id,
      userId,
      role: 'ADM',
      field: 'active',
      oldValue: String(existing.active),
      newValue: String(updated.active),
    });

    return updated;
  });

  revalidatePath('/nsi/work-centers');
  return result;
}
