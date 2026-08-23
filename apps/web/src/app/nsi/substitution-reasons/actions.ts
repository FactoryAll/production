'use server';

// TODO T-017: заменить requireAdmin на центральную матрицу доступа (T-017)
import { revalidatePath } from 'next/cache';
import { prisma, writeAudit, type DeactivationWarning, getDeactivationWarnings as getDeactivationWarningsFromDb } from '@prodtrack/db';
import { requireAdmin } from '@/lib/auth/require-admin';
import { SubstitutionReason } from '@prodtrack/contracts';
import type { SubstitutionReason as PrismaSubstitutionReason } from '@prisma/client';

export interface SubstitutionReasonInput {
  code: SubstitutionReason;
  name: string;
}

const VALID_CODES = Object.values(SubstitutionReason);

function assertCode(code: SubstitutionReason): void {
  if (!VALID_CODES.includes(code)) {
    throw new Error('Код причины должен быть из списка: болезнь, неявка, ушёл смену, прочее');
  }
}

async function assertCodeUnique(code: SubstitutionReason, excludeId?: string): Promise<void> {
  const existing = await prisma.substitutionReason.findUnique({
    where: { code },
  });

  if (existing && existing.id !== excludeId) {
    throw new Error('Причина ввода за Оператора с таким кодом уже существует');
  }
}

function assertInput(input: SubstitutionReasonInput): void {
  assertCode(input.code);
  if (!input.name.trim()) {
    throw new Error('Наименование обязательно');
  }
}

export async function createSubstitutionReason(input: SubstitutionReasonInput): Promise<PrismaSubstitutionReason> {
  const { userId } = await requireAdmin();
  assertInput(input);
  await assertCodeUnique(input.code);

  const result = await prisma.$transaction(async (tx) => {
    const created = await tx.substitutionReason.create({
      data: {
        code: input.code,
        name: input.name.trim(),
        active: true,
      },
    });

    // TODO T-021: роль определяется по типу действия (Р-23), сейчас захардкожено ADM
    await writeAudit(tx, {
      action: 'CREATE',
      objectType: 'SubstitutionReason',
      objectId: created.id,
      userId,
      role: 'ADM',
      newValue: JSON.stringify({ code: created.code, name: created.name }),
    });

    return created;
  });

  revalidatePath('/nsi/substitution-reasons');
  return result;
}

export async function updateSubstitutionReason(
  id: string,
  input: SubstitutionReasonInput,
): Promise<PrismaSubstitutionReason> {
  const { userId } = await requireAdmin();
  assertInput(input);
  await assertCodeUnique(input.code, id);

  const existing = await prisma.substitutionReason.findUniqueOrThrow({ where: { id } });
  const oldValue = JSON.stringify({ code: existing.code, name: existing.name });

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.substitutionReason.update({
      where: { id },
      data: {
        code: input.code,
        name: input.name.trim(),
      },
    });

    // TODO T-021: роль определяется по типу действия (Р-23), сейчас захардкожено ADM
    await writeAudit(tx, {
      action: 'UPDATE',
      objectType: 'SubstitutionReason',
      objectId: updated.id,
      userId,
      role: 'ADM',
      field: 'code,name',
      oldValue,
      newValue: JSON.stringify({ code: updated.code, name: updated.name }),
    });

    return updated;
  });

  revalidatePath('/nsi/substitution-reasons');
  return result;
}

// TODO Фаза 2/3: заменить заглушку на реальный запрос незавершённых документов (UC-M01-2, Р-22)
export async function getDeactivationWarnings(id: string): Promise<DeactivationWarning[]> {
  await requireAdmin();
  return getDeactivationWarningsFromDb('SubstitutionReason', id);
}

export async function toggleSubstitutionReasonActive(id: string): Promise<PrismaSubstitutionReason> {
  const { userId } = await requireAdmin();

  const existing = await prisma.substitutionReason.findUniqueOrThrow({ where: { id } });
  const newActive = !existing.active;

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.substitutionReason.update({
      where: { id },
      data: { active: newActive },
    });

    // TODO T-021: полноценная атрибуция роли в аудите (Р-23), сейчас захардкожено ADM
    await writeAudit(tx, {
      action: 'UPDATE',
      objectType: 'SubstitutionReason',
      objectId: updated.id,
      userId,
      role: 'ADM',
      field: 'active',
      oldValue: String(existing.active),
      newValue: String(updated.active),
    });

    return updated;
  });

  revalidatePath('/nsi/substitution-reasons');
  return result;
}
