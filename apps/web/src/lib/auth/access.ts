// TODO T-021: в будущих server actions атрибуция роли в аудите (writeAudit) должна определяться по типу действия, а не захардкоженным permission.
// TODO T-018-future: добавить UI выбора активной роли при входе и хранить activeRole в сессии,
// если потребуется разделение данных по ролям в одной сессии.
'use server';

import { hasPermission, requirePermission as requirePermissionSync, type PermissionCode } from '@prodtrack/contracts';
import { requireSession, type SessionWithUser } from './session';

export { hasPermission };

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