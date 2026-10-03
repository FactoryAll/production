import { hasPermission, type PermissionCode } from '@prodtrack/contracts';

export interface NavItem {
  label: string;
  href: string;
}

/**
 * Права, покрывающие просмотр Перемещений (M07 §3 / M08 §3).
 * Отдельного права `transfer:read` в матрице нет.
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

/**
 * Пункты главного меню видимы только тем ролям, у которых есть право
 * открыть соответствующую страницу (матрица доступа 00 §4.2).
 * Иначе пользователь попадает на страницу, падающую с ошибкой доступа.
 */
export function getNavItems(userRoles: string[]): NavItem[] {
  const items: NavItem[] = [
    { label: 'Дашборд', href: '/dashboard' },
    // Центр уведомлений M09: каждый пользователь видит только свои уведомления,
    // отдельного права в матрице доступа нет (M09 §3).
    { label: 'Уведомления', href: '/notifications' },
  ];

  if (hasPermission(userRoles, 'production_order:read')) {
    items.push({ label: 'ПЗ', href: '/production-orders' });
  }

  if (hasPermission(userRoles, 'production_order:accept')) {
    items.push({ label: 'Исполнение', href: '/shift-execution' });
  }

  if (hasPermission(userRoles, 'stock:read')) {
    items.push({ label: 'Остатки', href: '/stock' });
  }

  if (canViewTransfers(userRoles)) {
    items.push({ label: 'Перемещения', href: '/transfers' });
  }

  // Пункт «Отчёты» не выводится: страницы-списка /shift-reports нет,
  // по M06 отчёт за смену открывается из карточки ПЗ.

  return items;
}
