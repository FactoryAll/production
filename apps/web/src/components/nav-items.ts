import { hasPermission, type PermissionCode } from '@prodtrack/contracts';

export interface NavItem {
  label: string;
  href: string;
}

/**
 * Просмотр Перемещений определяется правом `transfer:read` (решение владельца
 * продукта 03.10.2026): оно есть у НП, КСГП, УСГП, С1С и АДМ.
 */
const TRANSFER_VIEW_PERMISSIONS: PermissionCode[] = ['transfer:read'];

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

  // Рабочее место 1С M12 — С1С и АДМ (M12 §3: просмотр данных для 1С — R у С1С и АДМ).
  if (hasPermission(userRoles, 'onec:read')) {
    items.push({ label: '1С', href: '/onec' });
  }

  // Аудит M13 доступен НП и АДМ (M13 §3, BR-3).
  if (hasPermission(userRoles, 'audit:read')) {
    items.push({ label: 'Аудит', href: '/audit' });
  }

  // Данные: очистка тестовых данных (T-076). Экран доступен только администратору,
  // поэтому пункт меню тоже показывается только ему.
  if (userRoles.includes('ADM')) {
    items.push({ label: 'Данные', href: '/data' });
  }

  // Роли M02: экран /roles защищён правом `roles:manage` (только АДМ). До T-069
  // пункта меню не было ни у одной роли, и экран открывался лишь по прямому адресу.
  if (hasPermission(userRoles, 'roles:manage')) {
    items.push({ label: 'Роли', href: '/roles' });
  }

  // Хронометраж M10 доступен всем ролям (M10 §3); ОПР видит только свой РЦ.
  items.push({ label: 'Хронометраж', href: '/timing' });

  // Пункт «Отчёты» не выводится: страницы-списка /shift-reports нет,
  // по M06 отчёт за смену открывается из карточки ПЗ.

  return items;
}
