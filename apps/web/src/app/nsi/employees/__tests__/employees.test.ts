import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Employee } from '@prisma/client';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@prodtrack/db', async () => {
  const actual = await vi.importActual<typeof import('@prodtrack/db')>('@prodtrack/db');
  return {
    ...actual,
    prisma: {
      $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
        const mockTx = {
          employee: {
            create: vi.fn(),
            update: vi.fn(),
            findUnique: vi.fn(),
            findUniqueOrThrow: vi.fn(),
          },
        };
        return cb(mockTx);
      }),
      employee: {
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(),
      },
    },
    writeAudit: vi.fn(),
    // Запрос незавершённых документов (Р-22) проверяется отдельно — в packages/db/src/deactivation.test.ts.
    getDeactivationWarnings: vi.fn(),
  };
});

vi.mock('@/lib/auth/access', () => ({
  requirePermission: vi.fn().mockResolvedValue({ userId: 'admin-user', user: { roles: [{ role: { code: 'ADM' } }] } } as any),
}));

const base: Employee = {
  id: 'e-1',
  fullName: 'Иванов Иван Иванович',
  tabNumber: '000123',
  active: true,
  canBeWorker: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('createEmployee', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects empty tab number', async () => {
    const { createEmployee } = await import('../actions');
    await expect(createEmployee({ fullName: 'Name', tabNumber: '   ', canBeWorker: true })).rejects.toThrow('Табельный номер обязателен');
  });

  it('rejects empty full name', async () => {
    const { createEmployee } = await import('../actions');
    await expect(createEmployee({ fullName: '', tabNumber: '000124', canBeWorker: true })).rejects.toThrow('ФИО обязательно');
  });

  it('rejects duplicate tab number', async () => {
    const { prisma } = await import('@prodtrack/db');
    (prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(base);
    const { createEmployee } = await import('../actions');
    await expect(createEmployee({ fullName: 'Other', tabNumber: '000123', canBeWorker: true })).rejects.toThrow('Сотрудник с таким табельным номером уже существует');
  });

  it('creates employee and writes audit', async () => {
    const { prisma, writeAudit } = await import('@prodtrack/db');
    (prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma as unknown as { $transaction: (cb: (tx: { employee: { create: () => Promise<unknown> } }) => Promise<unknown>) => Promise<unknown> }).$transaction = vi.fn(async (cb) => {
      const mockTx = {
        employee: {
          create: vi.fn().mockResolvedValue({
            id: 'new',
            fullName: 'Петров Петр Петрович',
            tabNumber: '000124',
            active: true,
          }),
        },
      };
      return cb(mockTx);
    });
    const { createEmployee } = await import('../actions');
    const created = await createEmployee({ fullName: 'Петров Петр Петрович', tabNumber: '000124', canBeWorker: true });
    expect(created.tabNumber).toBe('000124');
    expect(writeAudit).toHaveBeenCalled();
    const auditCall = (writeAudit as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(auditCall.userRoles).toEqual(['ADM']);
    expect(auditCall.permission).toBe('nsi:manage');
    expect(auditCall.action).toBe('CREATE');
  });

  it('сохраняет признак «Может привлекаться работником РЦ» и пишет его в аудит (T-071, M01 §4.1)', async () => {
    const { prisma, writeAudit } = await import('@prodtrack/db');
    (prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const create = vi.fn().mockResolvedValue({ ...base, id: 'new', canBeWorker: false });
    (prisma as unknown as { $transaction: (cb: (tx: { employee: { create: typeof create } }) => Promise<unknown>) => Promise<unknown> }).$transaction = vi.fn(async (cb) => cb({ employee: { create } }));

    const { createEmployee } = await import('../actions');
    await createEmployee({ fullName: 'Кладовщиков К.К.', tabNumber: '000126', canBeWorker: false });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ canBeWorker: false }),
    });
    const auditCall = (writeAudit as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(auditCall.newValue).toContain('"canBeWorker":false');
  });
});

describe('updateEmployee', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks duplicate tab number on another record', async () => {
    const { prisma } = await import('@prodtrack/db');
    (prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ ...base, id: 'other-id' });
    const { updateEmployee } = await import('../actions');
    await expect(updateEmployee('e-1', { fullName: 'X', tabNumber: '000123', canBeWorker: true })).rejects.toThrow('Сотрудник с таким табельным номером уже существует');
  });

  it('updates employee and writes audit', async () => {
    const { prisma, writeAudit } = await import('@prodtrack/db');
    (prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.employee.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(base);
    (prisma as unknown as { $transaction: (cb: (tx: { employee: { update: () => Promise<unknown> } }) => Promise<unknown>) => Promise<unknown> }).$transaction = vi.fn(async (cb) => {
      const mockTx = {
        employee: {
          update: vi.fn().mockResolvedValue({ ...base, fullName: 'Сидоров Сидор', tabNumber: '000125' }),
        },
      };
      return cb(mockTx);
    });
    const { updateEmployee } = await import('../actions');
    const updated = await updateEmployee('e-1', { fullName: 'Сидоров Сидор', tabNumber: '000125', canBeWorker: true });
    expect(updated.tabNumber).toBe('000125');
    expect(writeAudit).toHaveBeenCalled();
    const auditCall = (writeAudit as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(auditCall.action).toBe('UPDATE');
  });
});

describe('UC-M01-2: предупреждение о незавершённых документах при деактивации (Р-22, T-068)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('требует право и передаёт тип сущности в запрос незавершённых документов', async () => {
    const { requirePermission } = await import('@/lib/auth/access');
    const { getDeactivationWarnings: dbWarnings } = await import('@prodtrack/db');
    (dbWarnings as ReturnType<typeof vi.fn>).mockResolvedValue([
      { type: 'PRODUCTION_ORDER', id: 'po-1', label: 'ПЗ po-1 · В работе' },
    ]);
    const { getDeactivationWarnings } = await import('../actions');

    const warnings = await getDeactivationWarnings('e-1');

    expect(requirePermission).toHaveBeenCalledWith('nsi:manage');
    expect(dbWarnings).toHaveBeenCalledWith('Employee', 'e-1');
    expect(warnings).toHaveLength(1);
  });
});