import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoleCode } from '@prodtrack/contracts';

const mockAudit = vi.fn();
const mockTx = {
  user: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
  userRole: { createMany: vi.fn(), deleteMany: vi.fn() },
  session: { deleteMany: vi.fn() },
  auditRecord: { create: vi.fn() },
};

const prisma = {
  user: { findUnique: vi.fn(), findFirst: vi.fn(), findUniqueOrThrow: vi.fn() },
  role: { findMany: vi.fn() },
  $transaction: vi.fn(async (fn: (tx: typeof mockTx) => unknown) => fn(mockTx)),
} as unknown as import('@prodtrack/db').PrismaClient;

vi.mock('@prodtrack/db', () => ({
  prisma,
  writeAudit: mockAudit,
  AuditAction: { CREATE: 'CREATE', UPDATE: 'UPDATE' },
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock('@/lib/auth/access', () => ({
  requirePermission: vi.fn(async () => ({
    userId: 'admin-id',
    user: { id: 'admin-id', roles: [{ role: { code: RoleCode.ADM } }] },
  })),
}));

vi.mock('@/lib/auth/password', () => ({
  hashPassword: vi.fn(async () => 'hashed'),
  isPasswordValid: vi.fn((password: string) => password.length >= 8 && /[a-zA-Z]/.test(password) && /[0-9]/.test(password)),
}));

async function importActions() {
  const { createUserAction, updateUserAction, resetPasswordAction, toggleUserActiveAction } = await import('./actions');
  return { createUserAction, updateUserAction, resetPasswordAction, toggleUserActiveAction };
}

function makeUser(overrides = {}) {
  return {
    id: 'user-1',
    login: 'operator',
    passwordHash: 'old-hash',
    active: true,
    mustChangePassword: false,
  notificationScope: 'ALL' as const,
    employeeId: 'emp-1',
    roles: [{ role: { code: RoleCode.OPR } }],
    ...overrides,
  };
}

function makeForm(data: Record<string, string | string[]>): FormData {
  const form = new FormData();
  Object.entries(data).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((v) => form.append(key, v));
    } else {
      form.append(key, value);
    }
  });
  return form;
}

describe('users actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a user with valid data', async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.user.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.role.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'role-opr', code: RoleCode.OPR }]);
    mockTx.user.create.mockResolvedValue(makeUser({ id: 'new-user' }));

    const { createUserAction } = await importActions();
    const result = await createUserAction(makeForm({
      login: 'operator',
      password: 'Password1',
      employeeId: 'emp-1',
      roles: [RoleCode.OPR],
    }));

    if (!result.success) throw new Error('update failed: ' + JSON.stringify(result));
    expect(result.success).toBe(true);
    expect(mockTx.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ active: true, mustChangePassword: true }),
    }));
    expect(mockTx.userRole.createMany).toHaveBeenCalledWith({
      data: [{ userId: 'new-user', roleId: 'role-opr' }],
    });
    expect(mockAudit).toHaveBeenCalled();
  });

  it('сохраняет направление уведомлений специалиста 1С (ОПЭ, 13.10.2026)', async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.user.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.role.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'role-s1c', code: RoleCode.S1C }]);
    mockTx.user.create.mockResolvedValue(makeUser({ id: 'new-user' }));

    const { createUserAction } = await importActions();
    const result = await createUserAction(makeForm({
      login: 's1c_mass',
      password: 'Password1',
      employeeId: 'emp-1',
      roles: [RoleCode.S1C],
      notificationScope: 'MASS',
    }));

    expect(result.success).toBe(true);
    expect(mockTx.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ notificationScope: 'MASS' }),
    }));
  });

  it('незнакомое направление уведомлений трактуется как «Все»', async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.user.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.role.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'role-s1c', code: RoleCode.S1C }]);
    mockTx.user.create.mockResolvedValue(makeUser({ id: 'new-user' }));

    const { createUserAction } = await importActions();
    await createUserAction(makeForm({
      login: 's1c_unknown',
      password: 'Password1',
      employeeId: 'emp-1',
      roles: [RoleCode.S1C],
      notificationScope: 'НЕИЗВЕСТНО',
    }));

    expect(mockTx.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ notificationScope: 'ALL' }),
    }));
  });

  it('fails to create a user with duplicate login', async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeUser());
    (prisma.user.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const { createUserAction } = await importActions();
    const result = await createUserAction(makeForm({
      login: 'operator',
      password: 'Password1',
      employeeId: 'emp-1',
      roles: [RoleCode.OPR],
    }));

    expect(result.success).toBe(false);
    expect(result.error).toContain('логином уже существует');
  });

  it('fails to create a user with a weak password', async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.user.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const { createUserAction } = await importActions();
    const result = await createUserAction(makeForm({
      login: 'operator',
      password: 'short',
      employeeId: 'emp-1',
      roles: [RoleCode.OPR],
    }));

    expect(result.success).toBe(false);
    expect(result.error).toContain('Пароль');
  });

  it('fails to create a user without roles', async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.user.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const { createUserAction } = await importActions();
    const result = await createUserAction(makeForm({
      login: 'operator',
      password: 'Password1',
      employeeId: 'emp-1',
      roles: [],
    }));

    expect(result.success).toBe(false);
    expect(result.error).toContain('без ролей');
  });

  it('fails to create a user when employee is already attached', async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.user.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(makeUser());

    const { createUserAction } = await importActions();
    const result = await createUserAction(makeForm({
      login: 'operator',
      password: 'Password1',
      employeeId: 'emp-1',
      roles: [RoleCode.OPR],
    }));

    expect(result.success).toBe(false);
    expect(result.error).toContain('Сотрудник уже привязан');
  });

  it('updates a user', async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeUser());
    (prisma.user.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.role.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'role-opr', code: RoleCode.OPR }]);
    mockTx.user.update.mockResolvedValue(makeUser());

    const { updateUserAction } = await importActions();
    const result = await updateUserAction('user-1', makeForm({
      employeeId: 'emp-2',
      roles: [RoleCode.OPR],
      active: 'true',
    }));

    expect(result.success).toBe(true);
    expect(mockTx.userRole.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(mockTx.userRole.createMany).toHaveBeenCalledWith({
      data: [{ userId: 'user-1', roleId: 'role-opr' }],
    });
    expect(mockAudit).toHaveBeenCalled();
  });

  // ОПЭ-23 (решение владельца 20.10.2026): администратор правит логин — опечатку
  // при создании иначе не исправить. Поле было readOnly, а действие логин не читало вовсе.
  it('меняет логин пользователя и пишет старое и новое значение в аудит', async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeUser({ login: 'usgp' }));
    (prisma.user.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.role.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'role-opr', code: RoleCode.OPR }]);
    mockTx.user.update.mockResolvedValue(makeUser({ login: 'usgp2' }));

    const { updateUserAction } = await importActions();
    const result = await updateUserAction('user-1', makeForm({
      login: 'USGP2',
      employeeId: 'emp-1',
      roles: [RoleCode.OPR],
      active: 'true',
    }));

    expect(result.success).toBe(true);
    expect(mockTx.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ login: 'usgp2' }),
    }));
    const auditInput = mockAudit.mock.calls.at(-1)?.[1] as { field: string; oldValue: string; newValue: string };
    expect(auditInput.field).toContain('login');
    expect(JSON.parse(auditInput.oldValue).login).toBe('usgp');
    expect(JSON.parse(auditInput.newValue).login).toBe('usgp2');
  });

  it('не даёт занять логин другого пользователя', async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeUser({ login: 'usgp' }))
      .mockResolvedValueOnce({ id: 'user-2', login: 'admin' });
    (prisma.user.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const { updateUserAction } = await importActions();
    const result = await updateUserAction('user-1', makeForm({
      login: 'admin',
      employeeId: 'emp-1',
      roles: [RoleCode.OPR],
      active: 'true',
    }));

    expect(result.success).toBe(false);
    expect(result.error).toContain('уже существует');
    expect(mockTx.user.update).not.toHaveBeenCalled();
  });

  it('blocks stripping the last role while active (UC-M02-2)', async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeUser({ roles: [{ role: { code: RoleCode.OPR } }] }));
    (prisma.user.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const { updateUserAction } = await importActions();
    const result = await updateUserAction('user-1', makeForm({
      employeeId: 'emp-1',
      roles: [],
      active: 'true',
    }));

    expect(result.success).toBe(false);
    expect(result.error).toContain('Снятие последней роли');
  });

  it('allows stripping the last role when also blocking the user (UC-M02-2)', async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeUser({ roles: [{ role: { code: RoleCode.OPR } }] }));
    (prisma.user.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    mockTx.user.update.mockResolvedValue(makeUser({ active: false, roles: [] }));

    const { updateUserAction } = await importActions();
    const result = await updateUserAction('user-1', makeForm({
      employeeId: 'emp-1',
      roles: [],
      active: 'false',
    }));

    expect(result.success).toBe(true);
    expect(mockTx.userRole.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(mockTx.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
  });

  it('resets the password, closes sessions and keeps the password out of the audit', async () => {
    (prisma.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(makeUser());
    mockTx.session.deleteMany.mockResolvedValue({ count: 2 });

    const { resetPasswordAction } = await importActions();
    const result = await resetPasswordAction('user-1');

    expect(result.success).toBe(true);
    expect((result.tempPassword ?? '').length).toBeGreaterThanOrEqual(8);
    expect(mockTx.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ mustChangePassword: true }),
    }));

    // Сброс — это восстановление доступа: открытые сессии пользователя завершаются.
    expect(mockTx.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });

    const audit = mockAudit.mock.calls[0][1];
    expect(audit.field).toBe('passwordHash,sessions');
    expect(JSON.stringify(audit)).not.toContain(result.tempPassword);
    expect(audit.newValue).toContain('sessionsClosed');
  });

  it('does not let a role without users:manage reset a password', async () => {
    // Сброс — административное действие: проверка права стоит в самом действии,
    // а не только на экране, поэтому прямой вызов ролью без права отклоняется.
    const { requirePermission } = await import('@/lib/auth/access');
    (requirePermission as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Forbidden: insufficient permissions'),
    );

    const { resetPasswordAction } = await importActions();
    const result = await resetPasswordAction('user-1');

    expect(result.success).toBe(false);
    expect(result.error).toContain('только администратору');
    expect(result.tempPassword).toBeUndefined();
    expect(mockTx.user.update).not.toHaveBeenCalled();
  });

  it('does not reset the administrator own password through the admin action', async () => {
    // Сброс завершает сессии, поэтому себе пароль так не меняют: администратора выбросило бы из системы.
    const { resetPasswordAction } = await importActions();
    const result = await resetPasswordAction('admin-id');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Смена пароля');
    expect(mockTx.user.update).not.toHaveBeenCalled();
  });

  it('blocks a user and deletes sessions', async () => {
    (prisma.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(makeUser());
    mockTx.user.update.mockResolvedValue(makeUser({ active: false }));

    const { toggleUserActiveAction } = await importActions();
    const result = await toggleUserActiveAction('user-1', false);

    expect(result.success).toBe(true);
    expect(mockTx.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(mockAudit).toHaveBeenCalled();
  });
});