import { RoleCode } from './index';

export type PermissionCode =
  | 'production_order:create'
  | 'production_order:update'
  | 'production_order:confirm'
  | 'production_order:read'
  | 'production_order:read_own'
  | 'production_order:accept'
  | 'production_order:report'
  | 'transfer:create'
  | 'transfer:update'
  | 'transfer:receive'
  | 'transfer:reconcile'
  | 'transfer:read'
  | 'stock:read'
  | 'shift_report:read'
  | 'dashboard:read'
  | 'dashboard:read_own'
  | 'audit:read'
  | 'timing:read'
  | 'onec:read'
  | 'onec:process'
  | 'nsi:manage'
  | 'nsi:manage_warehouses'
  | 'users:manage'
  | 'roles:manage'
  | 'nsi:read'
  | 'reports:read'
  // Доска производственного контура (T-103, решение владельца 29.10.2026): отдельное право,
  // потому что складские роли (КСГП, УСГП) не имеют production_order:read и иначе в контур
  // не попадают вовсе.
  | 'kanban:read';

export const ALL_PERMISSIONS: PermissionCode[] = [
  'production_order:create',
  'production_order:update',
  'production_order:confirm',
  'production_order:read',
  'production_order:read_own',
  'production_order:accept',
  'production_order:report',
  'transfer:create',
  'transfer:update',
  'transfer:receive',
  'transfer:reconcile',
  'transfer:read',
  'stock:read',
  'shift_report:read',
  'dashboard:read',
  'dashboard:read_own',
  'audit:read',
  'timing:read',
  'onec:read',
  'onec:process',
  'nsi:manage',
  'nsi:manage_warehouses',
  'users:manage',
  'roles:manage',
  'nsi:read',
  // Отчёты (решение владельца 26.10.2026). Право обязано быть в ALL_PERMISSIONS:
  // администратор получает права именно из этого списка, и без строки пункт «Отчёты»
  // ему не показывался (поймано на дев-стенде).
  'reports:read',
  // Доска производственного контура (T-103): то же правило — без строки здесь АДМ её не увидит.
  'kanban:read',
];

export const ROLE_PERMISSIONS: Record<RoleCode, PermissionCode[]> = {
  NP: [
    'reports:read',
    'kanban:read',
    'production_order:create',
    'production_order:update',
    'production_order:confirm',
    'production_order:read',
    'transfer:create',
    'transfer:update',
    'transfer:reconcile',
    'transfer:read',
    'stock:read',
    'shift_report:read',
    'dashboard:read',
    'audit:read',
    'timing:read',
    'nsi:read',
    // Ведение справочников (смены, номенклатура, сотрудники, РЦ, причины).
    // Склады остаются за АДМ — см. 'nsi:manage_warehouses' (Р-19).
    'nsi:manage',
  ],
  OPR: [
    'timing:read',
    'production_order:read_own',
    // Дефект №2 ручного тестирования v1.2.0: право `production_order:confirm`
    // давало Оператору подтверждение, отмену ПЗ, ввод за Оператора и корректировку
    // факта — по 00 §4.2 и Р-11/Р-12 это действия только НП. Право у ОПР убрано.
    'production_order:accept',
    'production_order:report',
    'stock:read',
    'dashboard:read_own',
    'nsi:read',
  ],
  KSGP: [
    'timing:read',
    // Доска контура (T-103): у КСГП нет production_order:read, поэтому колонки ПЗ ему
    // не показываются — но перемещения своего склада он видит на доске.
    'kanban:read',
    // Создание и корректировка Перемещения (решение владельца 21.10.2026, ОПЭ-25).
    'transfer:create',
    // Отправка черновика («Провести») требует transfer:update — без него созданный
    // черновик некуда деть (ОПЭ-26, проверено на проде 21.10.2026).
    'transfer:update',
    'transfer:read',
    'transfer:receive',
    'transfer:reconcile',
    'stock:read',
    'dashboard:read',
    'nsi:read',
  ],
  USGP: [
    'timing:read',
    // Доска контура (T-103): как и у КСГП — без колонок ПЗ, со своими перемещениями.
    'kanban:read',
    // Приёмка на Производственном складе (решение владельца 21.10.2026, ОПЭ-28).
    'transfer:receive',
    // Создание и корректировка Перемещения (решение владельца продукта, ОПЭ-20, 20.10.2026).
    // Отправка черновика требует transfer:update (ОПЭ-26).
    'transfer:update',
    // В коде одно право отвечает и за создание, и за правку черновика/отправленного —
    // разделить их нельзя, не разведя проверки в transfers/new, [id]/edit и actions.
    'transfer:create',
    'transfer:read',
    'transfer:reconcile',
    'stock:read',
    'dashboard:read',
    'nsi:read',
  ],
  S1C: [
    'reports:read',
    'kanban:read',
    'timing:read',
    // Просмотр ПЗ и Перемещений — чтобы переходить из уведомлений в целевой объект
    // (решение владельца продукта, 03.10.2026; согласованное изменение матрицы 00 §4.2).
    'transfer:read',
    'production_order:read',
    'onec:read',
    'onec:process',
    'stock:read',
    'dashboard:read',
    'nsi:read',
  ],
  ADM: [...ALL_PERMISSIONS],
  /**
   * Гостевая роль (решение владельца 25.10.2026): только просмотр.
   *
   * Экраны — ПЗ, Остатки, Перемещения и доска контура (решение владельца 31.10.2026:
   * гостю нужен обзор контура) — и ни одного права на изменение. Дашборд открывается
   * потому, что это точка входа после входа в систему; он не даёт доступа ни к чему сверх
   * этих экранов.
   */
  GUEST: [
    'production_order:read',
    'stock:read',
    'transfer:read',
    'dashboard:read',
    'kanban:read',
  ],
  /**
   * ОТК (решение владельца 26.10.2026): гостевой доступ на просмотр + отчёты.
   * Ни одного права на изменение — как у гостя.
   */
  // ОТК видит доску контура целиком: у него есть и ПЗ, и перемещения на чтение (T-103).
  OTK: [
    'production_order:read',
    'stock:read',
    'transfer:read',
    'dashboard:read',
    'reports:read',
    'kanban:read',
  ],
};

/** Role priority for audit attribution (highest → lowest). */
// Гость — последним: у него только чтение, и при атрибуции действий аудита его роль
// не должна перебивать рабочую роль пользователя.
export const ROLE_PRIORITY: RoleCode[] = ['ADM', 'NP', 'OPR', 'KSGP', 'USGP', 'S1C', 'OTK', 'GUEST'] as RoleCode[];

export function hasPermission(userRoles: string[], action: PermissionCode): boolean {
  return userRoles.some((role) => ROLE_PERMISSIONS[role as RoleCode]?.includes(action));
}

export function requirePermission(userRoles: string[], action: PermissionCode): void {
  if (!hasPermission(userRoles, action)) {
    throw new Error('Forbidden: insufficient permissions');
  }
}

export function getAttributeRole(
  userRoles: string[],
  action: PermissionCode,
): RoleCode | null {
  const matchingRoles = userRoles.filter((role) => ROLE_PERMISSIONS[role as RoleCode]?.includes(action));
  if (matchingRoles.length === 0) {
    return null;
  }
  return matchingRoles.reduce((highest, role) => {
    const highestIndex = ROLE_PRIORITY.indexOf(highest as RoleCode);
    const roleIndex = ROLE_PRIORITY.indexOf(role as RoleCode);
    return roleIndex < highestIndex ? role : highest;
  }, matchingRoles[0]) as RoleCode;
}

/**
 * Returns the highest-priority role among the user's roles, regardless of permission.
 * Useful for audit attribution of auth lifecycle events (login, logout, password change)
 * that are not tied to a specific permission.
 */
export function getPrimaryRole(userRoles: string[]): string | null {
  if (userRoles.length === 0) {
    return null;
  }
  for (const role of ROLE_PRIORITY) {
    if (userRoles.includes(role)) {
      return role;
    }
  }
  return userRoles[0];
}
