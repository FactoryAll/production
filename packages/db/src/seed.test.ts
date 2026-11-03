import { describe, it, expect, vi, afterEach } from 'vitest';
import bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import { ALL_PERMISSIONS, ROLE_PERMISSIONS } from '@prodtrack/contracts';
import {
  PERMISSIONS,
  ROLES,
  ROLE_PERMISSION_MAP,
  seedAdmin,
  seedDefectReasons,
  seedFirstLoginUser,
  seedMultiRoleUser,
  seedOprShiftUser,
  seedS1cUser,
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

describe('пароль администратора и тестовые учётные записи', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('пароль администратора берётся из ADMIN_INITIAL_PASSWORD', async () => {
    process.env.ADMIN_INITIAL_PASSWORD = 'S3cret-from-env!';
    const client = mockClient();
    client.role.findUnique.mockResolvedValue({ id: 'role-adm' });
    client.user.findUnique.mockResolvedValue(null);

    await seedAdmin(asClient(client));

    const hash = client.user.create.mock.calls[0][0].data.passwordHash as string;
    // Хеш bcrypt от заданного пароля — проверяем сравнением, а не формой строки.
    expect(await bcrypt.compare('S3cret-from-env!', hash)).toBe(true);
    expect(await bcrypt.compare('admin123', hash)).toBe(false);
  });

  it('без переменной пароль случайный и не равен прежнему admin123', async () => {
    delete process.env.ADMIN_INITIAL_PASSWORD;
    const client = mockClient();
    client.role.findUnique.mockResolvedValue({ id: 'role-adm' });
    client.user.findUnique.mockResolvedValue(null);

    await seedAdmin(asClient(client));

    const hash = client.user.create.mock.calls[0][0].data.passwordHash as string;
    expect(await bcrypt.compare('admin123', hash)).toBe(false);
  });

  it('два прогона без переменной дают разные пароли', async () => {
    delete process.env.ADMIN_INITIAL_PASSWORD;
    const hashes: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      const client = mockClient();
      client.role.findUnique.mockResolvedValue({ id: 'role-adm' });
      client.user.findUnique.mockResolvedValue(null);
      await seedAdmin(asClient(client));
      hashes.push(client.user.create.mock.calls[0][0].data.passwordHash as string);
    }
    // Хеши и так разные из-за соли, поэтому проверяем не строки, а что один пароль
    // не подходит к другому хешу: значит сгенерированы разные значения.
    expect(await bcrypt.compare('admin123', hashes[0])).toBe(false);
    expect(await bcrypt.compare('admin123', hashes[1])).toBe(false);
  });

  it('без SEED_TEST_USERS тестовые пользователи не создаются', async () => {
    delete process.env.SEED_TEST_USERS;
    const client = mockClient();

    await seedMultiRoleUser(asClient(client));
    await seedFirstLoginUser(asClient(client));
    await seedOprShiftUser(asClient(client));
    await seedS1cUser(asClient(client));

    expect(client.user.create).not.toHaveBeenCalled();
    // Даже роли не читаем: без флага функция выходит до любых запросов.
    expect(client.role.findMany).not.toHaveBeenCalled();
  });

  it('с SEED_TEST_USERS=true тестовые пользователи создаются', async () => {
    process.env.SEED_TEST_USERS = 'true';
    const client = mockClient();
    client.role.findMany.mockResolvedValue([{ id: 'role-np' }, { id: 'role-opr' }]);
    client.role.findUnique.mockResolvedValue({ id: 'role-opr' });
    client.user.findUnique.mockResolvedValue(null);

    await seedMultiRoleUser(asClient(client));
    await seedFirstLoginUser(asClient(client));
    await seedOprShiftUser(asClient(client));
    await seedS1cUser(asClient(client));

    const logins = client.user.create.mock.calls.map(
      (call) => (call[0] as { data: { login: string } }).data.login,
    );
    expect(logins).toEqual([
      TEST_MULTI_ROLE_LOGIN,
      TEST_FIRST_LOGIN_LOGIN,
      TEST_OPR_SHIFT_LOGIN,
      TEST_S1C_LOGIN,
    ]);
  });

  it('флаг читается строго: «yes», «1» и пустое значение тестовых не включают', async () => {
    for (const value of ['yes', '1', '', 'false']) {
      process.env.SEED_TEST_USERS = value;
      const client = mockClient();
      await seedMultiRoleUser(asClient(client));
      expect(client.user.create.mock.calls.length).toBe(0);
    }
  });

  it('флаг понимает регистр и пробелы: « TRUE » включает тестовых', async () => {
    process.env.SEED_TEST_USERS = ' TRUE ';
    const client = mockClient();
    client.role.findMany.mockResolvedValue([{ id: 'role-np' }, { id: 'role-opr' }]);
    client.user.findUnique.mockResolvedValue(null);

    await seedMultiRoleUser(asClient(client));

    expect(client.user.create).toHaveBeenCalledTimes(1);
  });
});

describe('seed configuration', () => {
  it('creates 8 roles', () => {
    expect(ROLES.length).toBe(8);
    const codes = ROLES.map((r) => r.code).sort();
    expect(codes).toEqual(['ADM', 'GUEST', 'KSGP', 'NP', 'OPR', 'OTK', 'S1C', 'USGP']);
  });

  // Регресс 25.10.2026 (ОПЭ-52): роль GUEST была добавлена только в карту прав, но не в список ROLES.
  // Сид перебирает ROLES, поэтому роль молча не создавалась, а «seeded successfully» печаталось.
  it('каждая роль из списка имеет набор прав, и наоборот', () => {
    const listed = ROLES.map((r) => r.code).sort();
    const mapped = Object.keys(ROLE_PERMISSION_MAP).sort();
    expect(mapped).toEqual(listed);
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
    // ОПЭ-25 (решение владельца 21.10.2026): КСГП создаёт и корректирует Перемещения.
    expect(ROLE_PERMISSION_MAP.KSGP).toContain('transfer:create');
    // ОПЭ-26: отправка черновика требует transfer:update — без него черновик не провести.
    expect(ROLE_PERMISSION_MAP.KSGP).toContain('transfer:update');
    expect(ROLE_PERMISSION_MAP.USGP).toContain('transfer:update');
    expect(ROLE_PERMISSION_MAP.USGP).toContain('transfer:reconcile');
    // ОПЭ-20 (решение владельца продукта, 20.10.2026): УСГП создаёт и корректирует Перемещения.
    expect(ROLE_PERMISSION_MAP.USGP).toContain('transfer:create');
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
    role: { findUnique: vi.fn(), findMany: vi.fn() },
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

    // 12 РЦ наливки и тубировки + «Маркировка ЧЗ» (код 13, решение владельца 26.10.2026).
    expect(client.workCenter.create).toHaveBeenCalledTimes(13);
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
    // Хеш — не открытый пароль, и тем более не прежний «admin123» из репозитория.
    expect(data.passwordHash).not.toBe('admin123');
    expect(data.roles).toEqual({ create: { roleId: 'role-adm' } });
  });

  // Инцидент 03.11.2026: копии базы нет, свежий прод поднимается сидом. Пароль из репозитория
  // и «первый вход без смены» были бы дырой на первом же деплое.
  it('первый вход администратора требует смены пароля', async () => {
    const client = mockClient();
    client.role.findUnique.mockResolvedValue({ id: 'role-adm' });
    client.user.findUnique.mockResolvedValue(null);

    await seedAdmin(asClient(client));

    expect(client.user.create.mock.calls[0][0].data.mustChangePassword).toBe(true);
  });
});

  // ОПЭ-59: «Маркировка ЧЗ» — ГП-РЦ (Массу не производит), потребляет только полуфабрикат.
  it('«Маркировка ЧЗ» создаётся как ГП-РЦ с кодом 13', async () => {
    const client = mockClient();
    client.workCenter.findUnique.mockResolvedValue(null);

    await seedWorkCenters(asClient(client));

    const marking = client.workCenter.create.mock.calls
      .map((call) => call[0].data)
      .find((data) => data.code === '13');
    expect(marking).toMatchObject({ code: '13', name: 'Маркировка ЧЗ', producesMass: false, active: true });
  });

/**
 * Сид и контракты не должны расходиться (T-103, 30.10.2026).
 *
 * В базе есть своя таблица прав ролей, и её видит экран «Роли» — но доступ в приложении
 * проверяется по матрице из `@prodtrack/contracts`. Две копии уже разъехались: `reports:read`
 * и `nsi:read` есть в контрактах, но не у всех ролей в сиде, а кода `nsi:read` в списке
 * PERMISSIONS не было вовсе — то есть в базу он не попадал никогда, и сид молча терял его
 * на `.filter(Boolean)`. Эти тесты держат копии вместе.
 */
describe('сид и контракты: матрица прав', () => {
  it('список прав в сиде совпадает с ALL_PERMISSIONS из контрактов', () => {
    const seeded = PERMISSIONS.map((permission) => permission.code).sort();
    const contract = [...ALL_PERMISSIONS].sort();
    expect(seeded).toEqual(contract);
  });

  it('права каждой роли в сиде совпадают с матрицей контрактов', () => {
    for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
      const seeded = [...ROLE_PERMISSION_MAP[role as keyof typeof ROLE_PERMISSION_MAP]].sort();
      expect(seeded, `роль ${role}`).toEqual([...permissions].sort());
    }
  });

  // T-103: доска контура — отдельное право; складские роли получают его, ОПР и гость — нет.
  // Гость получил доску на просмотр 31.10.2026 (решение владельца); право на изменение
  // у него по-прежнему не появляется — это проверяется отдельно.
  it('kanban:read есть у семи ролей и нет у ОПР', () => {
    for (const role of ['NP', 'ADM', 'S1C', 'OTK', 'KSGP', 'USGP', 'GUEST']) {
      expect(ROLE_PERMISSION_MAP[role as keyof typeof ROLE_PERMISSION_MAP]).toContain('kanban:read');
    }
    expect(ROLE_PERMISSION_MAP.OPR).not.toContain('kanban:read');
    // Право только на просмотр: ни одного права на действие у гостя быть не должно.
    const guestActions = (ROLE_PERMISSION_MAP.GUEST as string[]).filter(
      (permission) => !permission.endsWith(':read'),
    );
    expect(guestActions).toEqual([]);
  });
});
