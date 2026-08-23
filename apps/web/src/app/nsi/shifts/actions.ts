'use server';

import { revalidatePath } from 'next/cache';
import { prisma, writeAudit, type DeactivationWarning, getDeactivationWarnings as getDeactivationWarningsFromDb } from '@prodtrack/db';
import { requirePermission } from '@/lib/auth/access';
import type { Shift } from '@prisma/client';

export interface ShiftInput {
  number: 1 | 2;
  date: string; // ISO date string YYYY-MM-DD
}

const SHIFT_TIMES = {
  1: { start: '08:00', end: '20:00' },
  2: { start: '20:00', end: '08:00' },
};

function parseDate(date: string): Date {
  // Interpret YYYY-MM-DD as local midnight to avoid timezone drift
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) {
    throw new Error('Некорректная дата');
  }
  return new Date(year, month - 1, day);
}

function assertNumber(number: number): asserts number is 1 | 2 {
  if (number !== 1 && number !== 2) {
    throw new Error('Номер смены может быть только 1 или 2');
  }
}

async function assertUniquePair(number: 1 | 2, date: Date, excludeId?: string): Promise<void> {
  const existing = await prisma.shift.findUnique({
    where: { number_date: { number, date } },
  });

  if (existing && existing.id !== excludeId) {
    throw new Error('Смена с таким номером и датой уже существует');
  }
}

function getShiftTimes(number: 1 | 2): { start: string; end: string } {
  return SHIFT_TIMES[number];
}

export async function createShift(input: ShiftInput): Promise<Shift> {
  const { userId, user: userSession } = await requirePermission('nsi:manage');
  const roles = userSession.roles.map((ur) => ur.role.code);
  assertNumber(input.number);
  const date = parseDate(input.date);
  await assertUniquePair(input.number, date);

  const { start, end } = getShiftTimes(input.number);

  const result = await prisma.$transaction(async (tx) => {
    const created = await tx.shift.create({
      data: {
        number: input.number,
        date,
        start,
        end,
        active: true,
      },
    });

        await writeAudit(tx, {
      action: 'CREATE',
      objectType: 'Shift',
      objectId: created.id,
      userId,
      userRoles: roles,
      permission: 'nsi:manage',
      newValue: JSON.stringify({
        number: created.number,
        date: created.date.toISOString(),
        start: created.start,
        end: created.end,
      }),
    });

    return created;
  });

  revalidatePath('/nsi/shifts');
  return result;
}

export async function updateShift(id: string, input: ShiftInput): Promise<Shift> {
  const { userId, user: userSession } = await requirePermission('nsi:manage');
  const roles = userSession.roles.map((ur) => ur.role.code);
  assertNumber(input.number);
  const date = parseDate(input.date);
  await assertUniquePair(input.number, date, id);

  const existing = await prisma.shift.findUniqueOrThrow({ where: { id } });
  const oldValue = JSON.stringify({
    number: existing.number,
    date: existing.date.toISOString(),
    start: existing.start,
    end: existing.end,
  });

  const { start, end } = getShiftTimes(input.number);

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.shift.update({
      where: { id },
      data: {
        number: input.number,
        date,
        start,
        end,
      },
    });

        await writeAudit(tx, {
      action: 'UPDATE',
      objectType: 'Shift',
      objectId: updated.id,
      userId,
      userRoles: roles,
      permission: 'nsi:manage',
      field: 'number,date,start,end',
      oldValue,
      newValue: JSON.stringify({
        number: updated.number,
        date: updated.date.toISOString(),
        start: updated.start,
        end: updated.end,
      }),
    });

    return updated;
  });

  revalidatePath('/nsi/shifts');
  return result;
}

// TODO Фаза 2/3: заменить заглушку на реальный запрос незавершённых документов (UC-M01-2, Р-22)
export async function getDeactivationWarnings(id: string): Promise<DeactivationWarning[]> {
  await requirePermission('nsi:manage');
  return getDeactivationWarningsFromDb('Shift', id);
}

export async function toggleShiftActive(id: string): Promise<Shift> {
  const { userId, user: userSession } = await requirePermission('nsi:manage');
  const roles = userSession.roles.map((ur) => ur.role.code);

  const existing = await prisma.shift.findUniqueOrThrow({ where: { id } });
  const newActive = !existing.active;

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.shift.update({
      where: { id },
      data: { active: newActive },
    });

        await writeAudit(tx, {
      action: 'UPDATE',
      objectType: 'Shift',
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

  revalidatePath('/nsi/shifts');
  return result;
}