import { hasPermission, type PermissionCode } from '@prodtrack/contracts';

export interface NavItem {
  label: string;
  href: string;
}

/**
 * Просмотр Перемещений (M07 §3 / M08 §3) разрешён ролям НП, КСГП, УСГП и АДМ.
 * У ОПР прав на перемещения нет, поэтому пункт меню ему не показывается.
 * Отдельного права `transfer:read` в матрице нет — просмотр покрывается
 * любым из четырёх прав на перемещение.
 */
const TRANSFER_VIEW_PERMISSIONS: PermissionCode[] = [
  'transfer:create',
  'transfer:update',
  'transfer:receive',
  'transfer:reconcile',
];

export function canViewTransfers(userRoles: string[]): boolean {
  return TRANSFER_VIEW_PERMISSIONS.some((permission) => hasPermission(userRoles, permission));
}

export function getNavItems(userRoles: string[]): NavItem[] {
  const items: NavItem[] = [
    { label: 'Дашборд', href: '/dashboard' },
    { label: 'ПЗ', href: '/production-orders' },
    { label: 'Исполнение', href: '/shift-execution' },
    { label: 'Остатки', href: '/stock' },
  ];

  if (canViewTransfers(userRoles)) {
    items.push({ label: 'Перемещения', href: '/transfers' });
  }

  items.push({ label: 'Отчёты', href: '/shift-reports' });

  return items;
}
