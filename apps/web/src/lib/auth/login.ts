'use server';

import { AuditAction, prisma, writeAudit } from '@prodtrack/db';
import type { RoleCode } from '@prisma/client';
import { verifyPassword } from './password';

export interface LoginSuccess {
  success: true;
  userId: string;
  mustChangePassword: boolean;
}

export interface LoginFailure {
  success: false;
  error: string;
}

export type LoginResult = LoginSuccess | LoginFailure;

export interface LoginMeta {
  ip?: string;
  userAgent?: string;
}

function getUserRoleCodes(user: { roles: { role: { code: string } }[] }): RoleCode[] {
  return user.roles.map((ur) => ur.role.code as RoleCode);
}

export async function authenticate(
  login: string,
  password: string,
  meta: LoginMeta = {},
): Promise<LoginResult> {
  const user = await prisma.user.findUnique({
    where: { login },
    include: { roles: { include: { role: true } } },
  });

  const auditPayload = JSON.stringify({ ip: meta.ip ?? null, userAgent: meta.userAgent ?? null });

  if (!user) {
    await writeAudit(prisma, {
      action: AuditAction.LOGIN_FAILED,
      objectType: 'User',
      objectId: login,
      newValue: auditPayload,
    });
    return { success: false, error: 'Неверный логин или пароль' };
  }

  const userRoles = getUserRoleCodes(user);

  if (!user.active) {
    await writeAudit(prisma, {
      action: AuditAction.LOGIN_FAILED,
      objectType: 'User',
      objectId: user.id,
      userId: user.id,
      userRoles,
      permission: 'dashboard:read',
      newValue: auditPayload,
    });
    return { success: false, error: 'Пользователь заблокирован, обратитесь к администратору' };
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    await writeAudit(prisma, {
      action: AuditAction.LOGIN_FAILED,
      objectType: 'User',
      objectId: user.id,
      userId: user.id,
      userRoles,
      permission: 'dashboard:read',
      newValue: auditPayload,
    });
    return { success: false, error: 'Неверный логин или пароль' };
  }

  await writeAudit(prisma, {
    action: AuditAction.LOGIN,
    objectType: 'User',
    objectId: user.id,
    userId: user.id,
    userRoles,
    permission: 'dashboard:read',
    newValue: auditPayload,
  });

  return { success: true, userId: user.id, mustChangePassword: user.mustChangePassword };
}