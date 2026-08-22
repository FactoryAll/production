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
  };
});

vi.mock('@/lib/auth/require-admin', () => ({
  requireAdmin: vi.fn().mockResolvedValue({ userId: 'admin-user' }),
}));

const base: Employee = {
  id: 'e-1',
  fullName: 'Иванов Иван Иванович',
  tabNumber: '000123',
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('createEmployee', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects empty tab number', async () => {
    const { createEmployee } = await import('../actions');
    await expect(createEmployee({ fullName: 'Name', tabNumber: '   ' })).rejects.toThrow('Табельный номер обязателен');
  });

  it('rejects empty full name', async () => {
    const { createEmployee } = await import('../actions');
    await expect(createEmployee({ fullName: '', tabNumber: '000124' })).rejects.toThrow('ФИО обязательно');
  });

  it('rejects duplicate tab number', async () => {
    const { prisma } = await import('@prodtrack/db');
    (prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(base);
    const { createEmployee } = await import('../actions');
    await expect(createEmployee({ fullName: 'Other', tabNumber: '000123' })).rejects.toThrow('Сотрудник с таким табельным номером уже существует');
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
    const created = await createEmployee({ fullName: 'Петров Петр Петрович', tabNumber: '000124' });
    expect(created.tabNumber).toBe('000124');
    expect(writeAudit).toHaveBeenCalled();
    const auditCall = (writeAudit as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(auditCall.role).toBe('ADM');
    expect(auditCall.action).toBe('CREATE');
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
    await expect(updateEmployee('e-1', { fullName: 'X', tabNumber: '000123' })).rejects.toThrow('Сотрудник с таким табельным номером уже существует');
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
    const updated = await updateEmployee('e-1', { fullName: 'Сидоров Сидор', tabNumber: '000125' });
    expect(updated.tabNumber).toBe('000125');
    expect(writeAudit).toHaveBeenCalled();
    const auditCall = (writeAudit as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(auditCall.action).toBe('UPDATE');
  });
});

describe('toggleEmployeeActive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('toggles active flag and writes audit', async () => {
    const { prisma, writeAudit } = await import('@prodtrack/db');
    (prisma.employee.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(base);
    (prisma as unknown as { $transaction: (cb: (tx: { employee: { update: () => Promise<unknown> } }) => Promise<unknown>) => Promise<unknown> }).$transaction = vi.fn(async (cb) => {
      const mockTx = {
        employee: {
          update: vi.fn().mockResolvedValue({ ...base, active: false }),
        },
      };
      return cb(mockTx);
    });
    const { toggleEmployeeActive } = await import('../actions');
    const updated = await toggleEmployeeActive('e-1');
    expect(updated.active).toBe(false);
    expect(writeAudit).toHaveBeenCalled();
    const auditCall = (writeAudit as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(auditCall.field).toBe('active');
  });
});
