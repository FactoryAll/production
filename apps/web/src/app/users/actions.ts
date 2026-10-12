'use server';

import { revalidatePath } from 'next/cache';
import { prisma, writeAudit } from '@prodtrack/db';
import { requirePermission } from '@/lib/auth/access';
import { RoleCode } from '@prodtrack/contracts';
import { hashPassword, isPasswordValid } from '@/lib/auth/password';
import { generateTempPassword } from '@/lib/auth/temp-password';

const VALID_ROLES = Object.values(RoleCode);

function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}

function getUserRoleCodes(user: { roles: { role: { code: string } }[] }): RoleCode[] {
  return user.roles.map((ur) => ur.role.code as RoleCode);
}

async function assertLoginUnique(login: string, excludeId?: string): Promise<void> {
  const normalized = normalizeLogin(login);
  if (!normalized) { throw new Error('Логин обязателен'); }
  const existing = await prisma.user.findUnique({ where: { login: normalized } });
  if (existing && existing.id !== excludeId) {
    throw new Error('Пользователь с таким логином уже существует');
  }
}

async function assertEmployeeUnique(employeeId: string, excludeId?: string): Promise<void> {
  if (!employeeId) { throw new Error('Сотрудник обязателен'); }
  const existing = await prisma.user.findFirst({
    where: { employeeId, active: true, id: { not: excludeId } },
  });
  if (existing) { throw new Error('Сотрудник уже привязан к другому активному пользователю'); }
}

function assertPassword(password: string): void {
  if (!isPasswordValid(password)) {
    throw new Error('Пароль должен содержать минимум 8 символов, буквы и цифры');
  }
}

function parseRoles(formData: FormData): RoleCode[] {
  const roles = formData.getAll('roles') as string[];
  return roles.filter((r): r is RoleCode => VALID_ROLES.includes(r as RoleCode));
}

async function mapRoleCodesToIds(codes: RoleCode[]): Promise<{ id: string; code: string }[]> {
  const roles = await prisma.role.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true },
  });
  if (roles.length !== codes.length) {
    throw new Error('Одна или несколько ролей не найдены');
  }
  return roles;
}

export async function createUserAction(formData: FormData): Promise<{ success: boolean; error?: string }> {
  try {
    const { userId, user: adminSession } = await requirePermission('users:manage');
    const adminRoles = getUserRoleCodes(adminSession);

    const login = normalizeLogin(String(formData.get('login') ?? ''));
    const password = String(formData.get('password') ?? '');
    const employeeId = String(formData.get('employeeId') ?? '');
    const roles = parseRoles(formData);

    await assertLoginUnique(login);
    assertPassword(password);
    await assertEmployeeUnique(employeeId);
    if (roles.length === 0) {
      return { success: false, error: 'Пользователь без ролей не сможет войти в систему' };
    }

    const rolesWithIds = await mapRoleCodesToIds(roles);
    const passwordHash = await hashPassword(password);

    await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { login, passwordHash, employeeId, active: true, mustChangePassword: true },
      });
      await tx.userRole.createMany({
        data: rolesWithIds.map((r) => ({ userId: created.id, roleId: r.id })),
      });
      await writeAudit(tx, {
        action: 'CREATE',
        objectType: 'User',
        objectId: created.id,
        userId,
        userRoles: adminRoles,
        permission: 'users:manage',
        newValue: JSON.stringify({ login, employeeId, roles, active: true, mustChangePassword: true }),
      });
    });

    revalidatePath('/users');
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось создать пользователя';
    return { success: false, error: message };
  }
}

export async function updateUserAction(userId: string, formData: FormData): Promise<{ success: boolean; error?: string }> {
  try {
    const { userId: adminId, user: adminSession } = await requirePermission('users:manage');
    const adminRoles = getUserRoleCodes(adminSession);

    const existing = await prisma.user.findUnique({
      where: { id: userId },
      include: { roles: { include: { role: true } } },
    });
    if (!existing) { throw new Error('Пользователь не найден'); }

    const employeeId = String(formData.get('employeeId') ?? existing.employeeId ?? '');
    const roles = parseRoles(formData);
    const active = formData.get('active') === 'true';

    await assertEmployeeUnique(employeeId, userId);

    const hadRoles = existing.roles.length > 0;
    const wasActive = existing.active;
    if (roles.length === 0 && wasActive) {
      if (active) { return { success: false, error: 'Снятие последней роли заблокирует пользователя' }; }
    }

    const rolesWithIds = roles.length > 0 ? await mapRoleCodesToIds(roles) : [];

    const oldValue = JSON.stringify({
      employeeId: existing.employeeId,
      roles: existing.roles.map((ur) => ur.role.code),
      active: existing.active,
    });

    await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: { employeeId, active },
      });
      if (roles.length > 0 || hadRoles) {
        await tx.userRole.deleteMany({ where: { userId } });
        if (rolesWithIds.length > 0) {
          await tx.userRole.createMany({
            data: rolesWithIds.map((r) => ({ userId, roleId: r.id })),
          });
        }
      }
      if (!active && wasActive) { await tx.session.deleteMany({ where: { userId } }); }
      await writeAudit(tx, {
        action: 'UPDATE',
        objectType: 'User',
        objectId: updated.id,
        userId: adminId,
        userRoles: adminRoles,
        permission: 'users:manage',
        field: 'employeeId,roles,active',
        oldValue,
        newValue: JSON.stringify({ employeeId, roles, active }),
      });
    });

    revalidatePath('/users');
    revalidatePath('/users/' + userId + '/edit');
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось обновить пользователя';
    return { success: false, error: message };
  }
}

export async function resetPasswordAction(userId: string): Promise<{ success: boolean; tempPassword?: string; error?: string }> {
  try {
    // Право проверяется здесь, на сервере: скрытая кнопка — не защита, действие вызывается напрямую.
    const actor = await requirePermission('users:manage').catch(() => null);
    if (!actor) {
      return { success: false, error: 'Сброс пароля доступен только администратору' };
    }
    const adminId = actor.userId;
    const adminRoles = getUserRoleCodes(actor.user);

    // Себе пароль так не сбрасывают: смена своего пароля — на экране «Смена пароля»,
    // а сброс завершает сессии, то есть выбросил бы администратора из системы.
    if (userId === adminId) {
      return {
        success: false,
        error: 'Свой пароль так не сбрасывается: смените его на экране «Смена пароля»',
      };
    }

    await prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash, mustChangePassword: true },
      });

      // Сброс — это восстановление доступа: открытые сессии пользователя завершаются,
      // иначе старый вход продолжал бы работать, хотя пароль уже заменён.
      const closed = await tx.session.deleteMany({ where: { userId } });

      await writeAudit(tx, {
        action: 'UPDATE',
        objectType: 'User',
        objectId: userId,
        userId: adminId,
        userRoles: adminRoles,
        permission: 'users:manage',
        field: 'passwordHash,sessions',
        oldValue: '[REDACTED]',
        // Сам пароль в журнал не попадает — только факт сброса и число закрытых сессий.
        newValue: JSON.stringify({ password: '[RESET]', sessionsClosed: closed.count }),
      });
    });

    revalidatePath('/users');
    return { success: true, tempPassword };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось сбросить пароль';
    return { success: false, error: message };
  }
}

export async function toggleUserActiveAction(userId: string, active: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    const { userId: adminId, user: adminSession } = await requirePermission('users:manage');
    const adminRoles = getUserRoleCodes(adminSession);

    const existing = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

    await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: { active },
      });
      if (!active && existing.active) { await tx.session.deleteMany({ where: { userId } }); }
      await writeAudit(tx, {
        action: 'UPDATE',
        objectType: 'User',
        objectId: updated.id,
        userId: adminId,
        userRoles: adminRoles,
        permission: 'users:manage',
        field: 'active',
        oldValue: String(existing.active),
        newValue: String(updated.active),
      });
    });

    revalidatePath('/users');
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось изменить статус';
    return { success: false, error: message };
  }
}