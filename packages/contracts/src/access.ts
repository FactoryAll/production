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
  | 'roles:manage';

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
];

export const ROLE_PERMISSIONS: Record<RoleCode, PermissionCode[]> = {
  [RoleCode.NP]: [
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
  ],
  [RoleCode.OPR]: [
    'production_order:read_own',
    'production_order:accept',
    'production_order:report',
    'stock:read',
    'dashboard:read_own',
  ],
  [RoleCode.KSGP]: [
    'transfer:receive',
    'transfer:reconcile',
    'stock:read',
    'dashboard:read',
  ],
  [RoleCode.USGP]: [
    'transfer:reconcile',
    'stock:read',
    'dashboard:read',
  ],
  [RoleCode.S1C]: [
    'onec:read',
    'onec:process',
    'stock:read',
    'dashboard:read',
  ],
  [RoleCode.ADM]: [...ALL_PERMISSIONS],
};

export function hasPermission(userRoles: string[], action: PermissionCode): boolean {
  return userRoles.some((role) => ROLE_PERMISSIONS[role as RoleCode]?.includes(action));
}

export function requirePermission(userRoles: string[], action: PermissionCode): void {
  if (!hasPermission(userRoles, action)) {
    throw new Error('Forbidden: insufficient permissions');
  }
}
