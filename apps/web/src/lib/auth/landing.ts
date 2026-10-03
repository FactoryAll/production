import { hasPermission, type PermissionCode } from '@prodtrack/contracts';

/**
 * Права, покрывающие просмотр Перемещений (M07 §3 / M08 §3).
 * Отдельного права `transfer:read` в матрице нет.
 */
export const TRANSFER_VIEW_PERMISSIONS: PermissionCode[] = [
  'transfer:create',
  'transfer:update',
  'transfer:receive',
  'transfer:reconcile',
];

export function canViewTransfers(userRoles: string[]): boolean {
  return TRANSFER_VIEW_PERMISSIONS.some((permission) => hasPermission(userRoles, permission));
}

/**
 * Стартовая страница после входа (и после обязательной смены пароля).
 *
 * Нельзя жёстко вести всех на `/production-orders`: у КСГП, УСГП и С1С нет
 * права `production_order:read`, и такая страница падает с ошибкой доступа.
 * Маршрут подбирается по матрице доступа 00 §4.2.
 */
export function getLandingPath(userRoles: string[]): string {
  if (userRoles.includes('OPR') && userRoles.length === 1) {
    return '/shift-execution';
  }
  if (hasPermission(userRoles, 'production_order:read')) {
    return '/production-orders';
  }
  if (canViewTransfers(userRoles)) {
    return '/transfers';
  }
  if (hasPermission(userRoles, 'stock:read')) {
    return '/stock';
  }
  return '/change-password';
}
