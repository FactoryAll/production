// TODO T-018-future: добавить UI выбора активной роли при входе и хранить activeRole в сессии,
// если потребуется разделение данных по ролям в одной сессии.
// NOTE: Middleware проверяет только доступ к роуту. Фильтрация данных на уровне "свой РЦ"
// (production_order:read_own) ДОЛЖНА быть реализована в самом server action / Prisma-запросе
// через where: { workCenterId: user.workCenterId }.
'use server';

import { hasPermission, requirePermission as requirePermissionSync, type PermissionCode } from '@prodtrack/contracts';
import { requireSession, type SessionWithUser } from './session';
import { requireShiftWindow } from './require-shift-window';

export { hasPermission, requireShiftWindow };

export type { PermissionCode };

export async function requirePermission(action: PermissionCode): Promise<SessionWithUser> {
  const session = await requireSession();
  const roles = session.user.roles.map((ur) => ur.role.code);
  requirePermissionSync(roles, action);
  return session;
}

export async function requireAnyPermission(actions: PermissionCode[]): Promise<SessionWithUser> {
  const session = await requireSession();
  const roles = session.user.roles.map((ur) => ur.role.code);
  const allowed = actions.some((action) => hasPermission(roles, action));
  if (!allowed) {
    throw new Error('Forbidden: insufficient permissions');
  }
  return session;
}

export async function getCurrentUser(): Promise<SessionWithUser> {
  return requireSession();
}

export async function getUserRoles(session: SessionWithUser): Promise<string[]> {
  return session.user.roles.map((ur) => ur.role.code);
}