'use server';

import { revalidatePath } from 'next/cache';
import { prisma, writeAudit, type DeactivationWarning, getDeactivationWarnings as getDeactivationWarningsFromDb } from '@prodtrack/db';
import { requirePermission } from '@/lib/auth/access';
import type { AbsenceReason } from '@prisma/client';

export interface AbsenceReasonInput {
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

  const existing = await prisma.absenceReason.findUnique({
    where: { code: normalized },
  });

  if (existing && existing.id !== excludeId) {
    throw new Error('Причина неявки с таким кодом уже существует');
  }
}

function assertInput(input: AbsenceReasonInput): void {
  if (!input.name.trim()) {
    throw new Error('Наименование обязательно');
  }
}

export async function createAbsenceReason(input: AbsenceReasonInput): Promise<AbsenceReason> {
  const { userId, user: userSession } = await requirePermission('nsi:manage');
  const roles = userSession.roles.map((ur) => ur.role.code);
  const normalizedCode = normalizeCode(input.code);
  await assertCodeUnique(normalizedCode);
  assertInput(input);

  const result = await prisma.$transaction(async (tx) => {
    const created = await tx.absenceReason.create({
      data: {
        code: normalizedCode,
        name: input.name.trim(),
        active: true,
      },
    });

        await writeAudit(tx, {
      action: 'CREATE',
      objectType: 'AbsenceReason',
      objectId: created.id,
      userId,
      userRoles: roles,
      permission: 'nsi:manage',
      newValue: JSON.stringify({ code: created.code, name: created.name }),
    });

    return created;
  });

  revalidatePath('/nsi/absence-reasons');
  return result;
}

export async function updateAbsenceReason(id: string, input: AbsenceReasonInput): Promise<AbsenceReason> {
  const { userId, user: userSession } = await requirePermission('nsi:manage');
  const roles = userSession.roles.map((ur) => ur.role.code);
  const normalizedCode = normalizeCode(input.code);
  await assertCodeUnique(normalizedCode, id);
  assertInput(input);

  const existing = await prisma.absenceReason.findUniqueOrThrow({ where: { id } });
  const oldValue = JSON.stringify({ code: existing.code, name: existing.name });

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.absenceReason.update({
      where: { id },
      data: {
        code: normalizedCode,
        name: input.name.trim(),
      },
    });

        await writeAudit(tx, {
      action: 'UPDATE',
      objectType: 'AbsenceReason',
      objectId: updated.id,
      userId,
      userRoles: roles,
      permission: 'nsi:manage',
      field: 'code,name',
      oldValue,
      newValue: JSON.stringify({ code: updated.code, name: updated.name }),
    });

    return updated;
  });

  revalidatePath('/nsi/absence-reasons');
  return result;
}

// TODO Фаза 2/3: заменить заглушку на реальный запрос незавершённых документов (UC-M01-2, Р-22)
export async function getDeactivationWarnings(id: string): Promise<DeactivationWarning[]> {
  await requirePermission('nsi:manage');
  return getDeactivationWarningsFromDb('AbsenceReason', id);
}

export async function toggleAbsenceReasonActive(id: string): Promise<AbsenceReason> {
  const { userId, user: userSession } = await requirePermission('nsi:manage');
  const roles = userSession.roles.map((ur) => ur.role.code);

  const existing = await prisma.absenceReason.findUniqueOrThrow({ where: { id } });
  const newActive = !existing.active;

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.absenceReason.update({
      where: { id },
      data: { active: newActive },
    });

        await writeAudit(tx, {
      action: 'UPDATE',
      objectType: 'AbsenceReason',
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

  revalidatePath('/nsi/absence-reasons');
  return result;
}