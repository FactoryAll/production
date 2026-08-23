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
