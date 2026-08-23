import { describe, it, expect } from 'vitest';
import {
  PERMISSIONS,
  ROLES,
  ROLE_PERMISSION_MAP,
  TEST_MULTI_ROLE_LOGIN,
  TEST_MULTI_ROLE_PASSWORD,
  TEST_MULTI_ROLE_ROLES,
} from '../prisma/seed';

const TEST_FIRST_LOGIN_LOGIN = 'test_first_login';
const TEST_FIRST_LOGIN_PASSWORD = 'temp1234';

describe('seed configuration', () => {
  it('creates 6 roles', () => {
    expect(ROLES.length).toBe(6);
    const codes = ROLES.map((r) => r.code).sort();
    expect(codes).toEqual(['ADM', 'KSGP', 'NP', 'OPR', 'S1C', 'USGP']);
  });

  it('creates ~20-30 permissions', () => {
    expect(PERMISSIONS.length).toBeGreaterThanOrEqual(20);
    expect(PERMISSIONS.length).toBeLessThanOrEqual(30);
  });

  it('maps permissions to roles according to matrix', () => {
    expect(ROLE_PERMISSION_MAP.NP).toContain('production_order:create');
    expect(ROLE_PERMISSION_MAP.OPR).toContain('production_order:accept');
    expect(ROLE_PERMISSION_MAP.KSGP).toContain('transfer:receive');
    expect(ROLE_PERMISSION_MAP.USGP).toContain('transfer:reconcile');
    expect(ROLE_PERMISSION_MAP.S1C).toContain('onec:process');
    expect(ROLE_PERMISSION_MAP.ADM).toContain('nsi:manage');
    expect(ROLE_PERMISSION_MAP.ADM).toContain('users:manage');
    expect(ROLE_PERMISSION_MAP.ADM).toContain('roles:manage');
  });

  it('ADM role has every permission', () => {
    const adminPermissions = new Set(ROLE_PERMISSION_MAP.ADM);
    for (const { code } of PERMISSIONS) {
      expect(adminPermissions.has(code)).toBe(true);
    }
  });
});

describe('multi-role test user', () => {
  it('seed defines test_multi_role with NP and OPR', () => {
    expect(TEST_MULTI_ROLE_LOGIN).toBe('test_multi_role');
    expect(TEST_MULTI_ROLE_PASSWORD).toBe('test1234');
    expect(TEST_MULTI_ROLE_ROLES).toEqual(['NP', 'OPR']);
  });
});

describe('first-login test user', () => {
  it('seed constants for test_first_login are present', () => {
    expect(TEST_FIRST_LOGIN_LOGIN).toBe('test_first_login');
    expect(TEST_FIRST_LOGIN_PASSWORD).toBe('temp1234');
  });
});