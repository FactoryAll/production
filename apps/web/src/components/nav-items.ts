import { hasPermission, roleCanReceiveEvents, type PermissionCode } from '@prodtrack/contracts';

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

/** Справочники НСИ — пункты выпадающего меню «НСИ» в шапке. */
const NSI_ITEMS: NavItem[] = [
  { label: 'РЦ', href: '/nsi/work-centers' },
  { label: 'Сотрудники', href: '/nsi/employees' },
  { label: 'Номенклатура', href: '/nsi/products' },
  { label: 'Смены', href: '/nsi/shifts' },
  { label: 'Склады', href: '/nsi/warehouses' },
  { label: 'Причины', href: '/nsi/defect-reasons' },
];

/**
 * Меню «НСИ» показывается только тем, у кого есть право читать справочники.
 *
 * Раньше выпадающий список выводился в шапке без всякой проверки: гостевая роль
 * (решение владельца 25.10.2026) видела «НСИ», а по клику получала отказ доступа.
 */
export function getNsiNavItems(userRoles: string[]): NavItem[] {
  return hasPermission(userRoles, 'nsi:read') ? NSI_ITEMS : [];
}

/**
 * Пункты главного меню видимы только тем ролям, у которых есть право
 * открыть соответствующую страницу (матрица доступа 00 §4.2).
 * Иначе пользователь попадает на страницу, падающую с ошибкой доступа.
 */
export function getNavItems(userRoles: string[]): NavItem[] {
  const items: NavItem[] = [{ label: 'Дашборд', href: '/dashboard' }];

  // Центр уведомлений M09: каждый пользователь видит только свои, отдельного права
  // в матрице доступа нет (M09 §3). Но если роль не адресат ни одного события
  // (гостевая — решение владельца 25.10.2026), пункт и колокольчик ей не нужны.
  if (userRoles.some((role) => roleCanReceiveEvents(role))) {
    items.push({ label: 'Уведомления', href: '/notifications' });
  }

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

  // Пункт «Отчёты» не выводится: страницы-списка /shift-reports нет,
  // по M06 отчёт за смену открывается из карточки ПЗ.

  return items;
}

/**
 * Пункты выпадающего меню «Администрирование».
 *
 * Редкие в ежедневной работе экраны вынесены из основной полосы: тринадцать пунктов
 * вместе с брендом и блоком пользователя не помещались в шапку, и меню переносилось
 * на вторую строку (замечание владельца, 12.10.2026).
 *
 * Права проверяются здесь же: пункт показывается только тому, кто вправе открыть экран
 * (урок Фазы 6 — ссылки на недоступные страницы ведут на «Доступ запрещён»).
 */
export function getAdminNavItems(userRoles: string[]): NavItem[] {
  const items: NavItem[] = [];

  // Аудит M13 доступен НП и АДМ (M13 §3, BR-3).
  if (hasPermission(userRoles, 'audit:read')) {
    items.push({ label: 'Аудит', href: '/audit' });
  }

  // Данные: очистка тестовых данных (T-076) — только администратор.
  if (hasPermission(userRoles, 'users:manage')) {
    items.push({ label: 'Данные', href: '/data' });
  }

  // Роли M02: экран /roles защищён правом `roles:manage` (только АДМ). До T-069
  // пункта меню не было ни у одной роли, и экран открывался лишь по прямому адресу.
  if (hasPermission(userRoles, 'roles:manage')) {
    items.push({ label: 'Роли', href: '/roles' });
  }

  if (hasPermission(userRoles, 'users:manage')) {
    items.push({ label: 'Пользователи', href: '/users' });
  }

  // Хронометраж M10 доступен всем ролям (M10 §3); ОПР видит только свой РЦ.
  // Условие по праву, а не безусловный пункт: у гостевой роли (решение владельца 25.10.2026)
  // права `timing:read` нет, и пункт вёл бы на экран, который её не пустит.
  if (hasPermission(userRoles, 'timing:read')) {
    items.push({ label: 'Хронометраж', href: '/timing' });
  }

  return items;
}
