'use server';

import { revalidatePath } from 'next/cache';
import { prisma, writeAudit } from '@prodtrack/db';
import { requireAdmin } from '@/lib/auth/require-admin';
import type { Employee } from '@prisma/client';

export interface EmployeeInput {
  fullName: string;
  tabNumber: string;
}

function normalizeTabNumber(tabNumber: string): string {
  return tabNumber.trim();
}

async function assertTabNumberUnique(tabNumber: string, excludeId?: string): Promise<void> {
  const normalized = normalizeTabNumber(tabNumber);
  if (!normalized) {
    throw new Error('Табельный номер обязателен');
  }

  const existing = await prisma.employee.findUnique({
    where: { tabNumber: normalized },
  });

  if (existing && existing.id !== excludeId) {
    throw new Error('Сотрудник с таким табельным номером уже существует');
  }
}

function assertInput(input: EmployeeInput): void {
  if (!input.fullName.trim()) {
    throw new Error('ФИО обязательно');
  }
}

export async function createEmployee(input: EmployeeInput): Promise<Employee> {
  const { userId } = await requireAdmin();
  const normalizedTabNumber = normalizeTabNumber(input.tabNumber);
  await assertTabNumberUnique(normalizedTabNumber);
  assertInput(input);

  const result = await prisma.$transaction(async (tx) => {
    const created = await tx.employee.create({
      data: {
        fullName: input.fullName.trim(),
        tabNumber: normalizedTabNumber,
        active: true,
      },
    });

    // TODO T-021: роль определяется по типу действия (Р-23), сейчас захардкожено ADM
    await writeAudit(tx, {
      action: 'CREATE',
      objectType: 'Employee',
      objectId: created.id,
      userId,
      role: 'ADM',
      newValue: JSON.stringify({
        fullName: created.fullName,
        tabNumber: created.tabNumber,
      }),
    });

    return created;
  });

  revalidatePath('/nsi/employees');
  return result;
}

export async function updateEmployee(id: string, input: EmployeeInput): Promise<Employee> {
  const { userId } = await requireAdmin();
  const normalizedTabNumber = normalizeTabNumber(input.tabNumber);
  await assertTabNumberUnique(normalizedTabNumber, id);
  assertInput(input);

  const existing = await prisma.employee.findUniqueOrThrow({ where: { id } });
  const oldValue = JSON.stringify({
    fullName: existing.fullName,
    tabNumber: existing.tabNumber,
  });

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.employee.update({
      where: { id },
      data: {
        fullName: input.fullName.trim(),
        tabNumber: normalizedTabNumber,
      },
    });

    // TODO T-021: роль определяется по типу действия (Р-23), сейчас захардкожено ADM
    await writeAudit(tx, {
      action: 'UPDATE',
      objectType: 'Employee',
      objectId: updated.id,
      userId,
      role: 'ADM',
      field: 'fullName,tabNumber',
      oldValue,
      newValue: JSON.stringify({
        fullName: updated.fullName,
        tabNumber: updated.tabNumber,
      }),
    });

    return updated;
  });

  revalidatePath('/nsi/employees');
  return result;
}

export async function toggleEmployeeActive(id: string): Promise<Employee> {
  const { userId } = await requireAdmin();

  const existing = await prisma.employee.findUniqueOrThrow({ where: { id } });
  const newActive = !existing.active;

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.employee.update({
      where: { id },
      data: { active: newActive },
    });

    // TODO T-021: роль определяется по типу действия (Р-23), сейчас захардкожено ADM
    await writeAudit(tx, {
      action: 'UPDATE',
      objectType: 'Employee',
      objectId: updated.id,
      userId,
      role: 'ADM',
      field: 'active',
      oldValue: String(existing.active),
      newValue: String(updated.active),
    });

    return updated;
  });

  revalidatePath('/nsi/employees');
  return result;
}
