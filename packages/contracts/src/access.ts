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
  | 'stock:read'
  | 'shift_report:read'
  | 'dashboard:read'
  | 'dashboard:read_own'
  | 'audit:read'
  | 'onec:read'
  | 'onec:process'
  | 'nsi:manage'
  | 'users:manage'
  | 'roles:manage'
  | 'nsi:read';

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
  'stock:read',
  'shift_report:read',
  'dashboard:read',
  'dashboard:read_own',
  'audit:read',
  'onec:read',
  'onec:process',
  'nsi:manage',
  'users:manage',
  'roles:manage',
  'nsi:read',
];

export const ROLE_PERMISSIONS: Record<RoleCode, PermissionCode[]> = {
  NP: [
    'production_order:create',
    'production_order:update',
    'production_order:confirm',
    'production_order:read',
    'transfer:create',
    'transfer:update',
    'stock:read',
    'shift_report:read',
    'dashboard:read',
    'audit:read',
    'nsi:read',
  ],
  OPR: [
    'production_order:read_own',
    'production_order:accept',
    'production_order:report',
    'stock:read',
    'dashboard:read_own',
    'nsi:read',
  ],
  KSGP: [
    'transfer:receive',
    'transfer:reconcile',
    'stock:read',
    'dashboard:read',
    'nsi:read',
  ],
  USGP: [
    'transfer:reconcile',
    'stock:read',
    'dashboard:read',
    'nsi:read',
  ],
  S1C: [
    'onec:read',
    'onec:process',
    'stock:read',
    'dashboard:read',
    'nsi:read',
  ],
  ADM: [...ALL_PERMISSIONS],
};

/** Role priority for audit attribution (highest → lowest). */
export const ROLE_PRIORITY: RoleCode[] = ['ADM', 'NP', 'OPR', 'KSGP', 'USGP', 'S1C'] as RoleCode[];

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
