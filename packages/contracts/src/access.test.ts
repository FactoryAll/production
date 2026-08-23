import { describe, it, expect } from 'vitest';
import {
  RoleCode,
  hasPermission,
  requirePermission,
  ALL_PERMISSIONS,
  ROLE_PERMISSIONS,
} from './index';

describe('access matrix', () => {
  it('hasPermission returns true for a role with the permission', () => {
    expect(hasPermission([RoleCode.NP], 'production_order:create')).toBe(true);
    expect(hasPermission([RoleCode.OPR], 'production_order:accept')).toBe(true);
    expect(hasPermission([RoleCode.KSGP], 'transfer:receive')).toBe(true);
    expect(hasPermission([RoleCode.ADM], 'nsi:manage')).toBe(true);
  });

  it('hasPermission returns false for a role without the permission', () => {
    expect(hasPermission([RoleCode.OPR], 'production_order:create')).toBe(false);
    expect(hasPermission([RoleCode.KSGP], 'production_order:read_own')).toBe(false);
    expect(hasPermission([RoleCode.NP], 'transfer:receive')).toBe(false);
    expect(hasPermission([RoleCode.S1C], 'nsi:manage')).toBe(false);
  });

  it('combines permissions when user has multiple roles (Р-23)', () => {
    expect(hasPermission([RoleCode.OPR, RoleCode.KSGP], 'production_order:accept')).toBe(true);
    expect(hasPermission([RoleCode.OPR, RoleCode.KSGP], 'transfer:receive')).toBe(true);
    expect(hasPermission([RoleCode.OPR, RoleCode.KSGP], 'nsi:manage')).toBe(false);
  });

  it('requirePermission throws for missing permission', () => {
    expect(() => requirePermission([RoleCode.OPR], 'nsi:manage')).toThrow('Forbidden');
  });

  it('requirePermission does not throw for allowed permission', () => {
    expect(() => requirePermission([RoleCode.ADM], 'users:manage')).not.toThrow();
  });

  it('ADM role has every permission', () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(hasPermission([RoleCode.ADM], permission)).toBe(true);
    }
  });

  it('ROLE_PERMISSIONS matches matrix expectations', () => {
    expect(ROLE_PERMISSIONS[RoleCode.NP]).toContain('production_order:create');
    expect(ROLE_PERMISSIONS[RoleCode.OPR]).toContain('dashboard:read_own');
    expect(ROLE_PERMISSIONS[RoleCode.KSGP]).toContain('transfer:reconcile');
    expect(ROLE_PERMISSIONS[RoleCode.USGP]).toContain('transfer:reconcile');
    expect(ROLE_PERMISSIONS[RoleCode.S1C]).toContain('onec:process');
  });
});
