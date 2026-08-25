import { describe, it, expect } from 'vitest';
import {
  RoleCode,
  hasPermission,
  requirePermission,
  getAttributeRole,
  getPrimaryRole,
  ALL_PERMISSIONS,
  ROLE_PERMISSIONS,
  ROLE_PRIORITY,
} from './index';

describe('access matrix', () => {
  it('hasPermission returns true for a role with the permission', () => {
    expect(hasPermission([RoleCode.NP], 'production_order:create')).toBe(true);
    expect(hasPermission([RoleCode.OPR], 'production_order:accept')).toBe(true);
    expect(hasPermission([RoleCode.OPR], 'production_order:confirm')).toBe(true);
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
    expect(hasPermission([RoleCode.NP, RoleCode.OPR], 'production_order:report')).toBe(true);
    expect(hasPermission([RoleCode.NP, RoleCode.OPR], 'stock:read')).toBe(true);
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

describe('getAttributeRole', () => {
  it('returns the only role that has the permission', () => {
    expect(getAttributeRole([RoleCode.NP, RoleCode.OPR], 'production_order:report')).toBe(RoleCode.OPR);
  });

  it('returns the highest-priority role when multiple roles have the permission', () => {
    expect(getAttributeRole([RoleCode.NP, RoleCode.OPR], 'stock:read')).toBe(RoleCode.NP);
    expect(getAttributeRole([RoleCode.KSGP, RoleCode.OPR], 'stock:read')).toBe(RoleCode.OPR);
  });

  it('returns ADM for any action when ADM is in roles', () => {
    expect(getAttributeRole([RoleCode.ADM, RoleCode.NP], 'production_order:create')).toBe(RoleCode.ADM);
    expect(getAttributeRole([RoleCode.ADM, RoleCode.OPR], 'dashboard:read_own')).toBe(RoleCode.ADM);
  });

  it('returns null when no role has the permission', () => {
    expect(getAttributeRole([RoleCode.OPR], 'nsi:manage')).toBeNull();
    expect(getAttributeRole([RoleCode.S1C], 'production_order:create')).toBeNull();
  });

  it('priority order is ADM > NP > OPR > KSGP > USGP > S1C', () => {
    expect(ROLE_PRIORITY).toEqual([RoleCode.ADM, RoleCode.NP, RoleCode.OPR, RoleCode.KSGP, RoleCode.USGP, RoleCode.S1C]);
  });
});

describe('getPrimaryRole', () => {
  it('returns null for empty roles', () => {
    expect(getPrimaryRole([])).toBeNull();
  });

  it('returns the only role when single role is provided', () => {
    expect(getPrimaryRole([RoleCode.OPR])).toBe(RoleCode.OPR);
  });

  it('returns the highest-priority role regardless of permission', () => {
    expect(getPrimaryRole([RoleCode.OPR, RoleCode.NP])).toBe(RoleCode.NP);
    expect(getPrimaryRole([RoleCode.KSGP, RoleCode.OPR])).toBe(RoleCode.OPR);
    expect(getPrimaryRole([RoleCode.ADM, RoleCode.NP])).toBe(RoleCode.ADM);
  });
});
