'use server';

import { prisma } from '@prodtrack/db';
import { requirePermission } from '@/lib/auth/access';
import { RoleCode } from '@prodtrack/contracts';

export async function listUsers(search?: string, active?: boolean) {
  await requirePermission('users:manage');
  return prisma.user.findMany({
    where: {
      ...(search ? {
        OR: [
          { login: { contains: search, mode: 'insensitive' } },
          { employee: { fullName: { contains: search, mode: 'insensitive' } } },
        ],
      } : {}),
      ...(active !== undefined ? { active } : {}),
    },
    include: {
      roles: { include: { role: true } },
      employee: true,
    },
    orderBy: { login: 'asc' },
  });
}

export async function getUserWithRoles(id: string) {
  await requirePermission('users:manage');
  return prisma.user.findUnique({
    where: { id },
    include: {
      roles: { include: { role: true } },
      employee: true,
    },
  });
}

export async function listEmployeesForSelect() {
  await requirePermission('users:manage');
  return prisma.employee.findMany({
    where: { active: true },
    orderBy: { fullName: 'asc' },
    select: { id: true, fullName: true, tabNumber: true },
  });
}

export async function listRolesWithPermissionCounts() {
  await requirePermission('roles:manage');
  return prisma.role.findMany({
    include: {
      _count: { select: { users: true, permissions: true } },
    },
    orderBy: { code: 'asc' },
  });
}

export async function getRoleWithPermissions(code: string) {
  await requirePermission('roles:manage');
  return prisma.role.findUnique({
    where: { code: code as RoleCode },
    include: {
      permissions: true,
    },
  });
}