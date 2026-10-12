import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  PERMISSIONS,
  ROLES,
  ROLE_PERMISSION_MAP,
  seedAdmin,
  seedDefectReasons,
  seedSubstitutionReasons,
  seedWarehouses,
  seedWorkCenters,
  TEST_MULTI_ROLE_LOGIN,
  TEST_MULTI_ROLE_PASSWORD,
  TEST_MULTI_ROLE_ROLES,
  TEST_OPR_SHIFT_LOGIN,
  TEST_OPR_SHIFT_PASSWORD,
  TEST_S1C_LOGIN,
  TEST_S1C_PASSWORD,
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
    expect(ROLE_PERMISSION_MAP.OPR).toContain('production_order:report');
    // Дефект №2 (v1.2.0): подтверждение/отмена ПЗ и ввод за Оператора — действия НП.
    expect(ROLE_PERMISSION_MAP.OPR).not.toContain('production_order:confirm');
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

describe('opr-shift test user', () => {
  it('seed constants for test_opr_shift are present', () => {
    expect(TEST_OPR_SHIFT_LOGIN).toBe('test_opr_shift');
    expect(TEST_OPR_SHIFT_PASSWORD).toBe('opr12345');
  });
});

describe('s1c test user', () => {
  it('seed constants for test_s1c are present', () => {
    expect(TEST_S1C_LOGIN).toBe('test_s1c');
    expect(TEST_S1C_PASSWORD).toBe('s1c12345');
  });
});

/**
 * Мок без методов update и upsert: если сид снова начнёт перезаписывать существующие записи,
 * тест упадёт — «client.workCenter.upsert is not a function». Именно так выглядел дефект,
 * из-за которого правки справочника исчезали после каждого развёртывания.
 */
function mockClient() {
  return {
    workCenter: { findUnique: vi.fn(), create: vi.fn() },
    warehouse: { findFirst: vi.fn(), create: vi.fn() },
    substitutionReason: { findUnique: vi.fn(), create: vi.fn() },
    defectReason: { findUnique: vi.fn(), create: vi.fn() },
    role: { findUnique: vi.fn() },
    user: { findUnique: vi.fn(), create: vi.fn() },
  };
}

const asClient = (client: ReturnType<typeof mockClient>) => client as unknown as PrismaClient;

describe('Сид не перезаписывает данные, которые ведёт администратор', () => {
  it('существующий РЦ остаётся как есть: название и активность не возвращаются к исходным', async () => {
    const client = mockClient();
    client.workCenter.findUnique.mockResolvedValue({ id: 'wc-1', code: '01', name: 'Реактор' });

    await seedWorkCenters(asClient(client));

    expect(client.workCenter.findUnique).toHaveBeenCalledWith({ where: { code: '01' } });
    expect(client.workCenter.create).not.toHaveBeenCalled();
  });

  it('отсутствующие РЦ создаются с правилом «производит массу» (Р-02)', async () => {
    const client = mockClient();
    client.workCenter.findUnique.mockResolvedValue(null);

    await seedWorkCenters(asClient(client));

    expect(client.workCenter.create).toHaveBeenCalledTimes(12);
    expect(client.workCenter.create.mock.calls[0][0].data).toMatchObject({
      code: '01',
      producesMass: true,
      active: true,
    });
    expect(client.workCenter.create.mock.calls[2][0].data).toMatchObject({
      code: '03',
      producesMass: false,
    });
  });

  it('склад ищется по типу, чтобы переименование не завело второй склад (Р-19)', async () => {
    const client = mockClient();
    client.warehouse.findFirst.mockResolvedValue({ id: 'wh-1', name: 'Цех' });

    await seedWarehouses(asClient(client));

    expect(client.warehouse.findFirst).toHaveBeenCalledWith({ where: { type: 'PRODUCTION' } });
    expect(client.warehouse.create).not.toHaveBeenCalled();
  });

  it('существующие причины брака и ввода за Оператора не пересоздаются', async () => {
    const client = mockClient();
    client.substitutionReason.findUnique.mockResolvedValue({ id: 'r-1' });
    client.defectReason.findUnique.mockResolvedValue({ id: 'd-1' });

    await seedSubstitutionReasons(asClient(client));
    await seedDefectReasons(asClient(client));

    expect(client.substitutionReason.create).not.toHaveBeenCalled();
    expect(client.defectReason.create).not.toHaveBeenCalled();
  });

  it('пароль существующего администратора не сбрасывается', async () => {
    const client = mockClient();
    client.role.findUnique.mockResolvedValue({ id: 'role-adm' });
    client.user.findUnique.mockResolvedValue({ id: 'user-adm' });

    await seedAdmin(asClient(client));

    expect(client.user.create).not.toHaveBeenCalled();
  });

  it('администратор создаётся, когда его ещё нет', async () => {
    const client = mockClient();
    client.role.findUnique.mockResolvedValue({ id: 'role-adm' });
    client.user.findUnique.mockResolvedValue(null);

    await seedAdmin(asClient(client));

    const data = client.user.create.mock.calls[0][0].data;
    expect(data.login).toBe('admin');
    expect(data.passwordHash).not.toBe('admin123');
    expect(data.roles).toEqual({ create: { roleId: 'role-adm' } });
  });
});
