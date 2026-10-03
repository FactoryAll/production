import { hasPermission, type PermissionCode } from '@prodtrack/contracts';
import { requireSession, type SessionWithUser } from './session';

export interface PageAccess {
  session: SessionWithUser;
  roles: string[];
  allowed: boolean;
}

/**
 * Проверка доступа на уровне страницы (серверный компонент) без выброса исключения.
 *
 * Позволяет вернуть понятный экран «Доступ запрещён» вместо
 * «Application error: a server-side exception has occurred» (T-067).
 * Функции загрузки данных по-прежнему проверяют права самостоятельно —
 * защита в глубину.
 */
export async function checkPageAccess(
  permission: PermissionCode | PermissionCode[],
): Promise<PageAccess> {
  const session = await requireSession();
  const roles = session.user.roles.map((ur) => ur.role.code);
  const permissions = Array.isArray(permission) ? permission : [permission];
  const allowed = permissions.some((item) => hasPermission(roles, item));

  return { session, roles, allowed };
}
