import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorkCenter } from '@prisma/client';

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
          workCenter: {
            create: vi.fn(),
            update: vi.fn(),
            findUnique: vi.fn(),
            findUniqueOrThrow: vi.fn(),
          },
        };
        return cb(mockTx);
      }),
      workCenter: {
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

const base: WorkCenter = {
  id: 'wc-1',
  code: '03',
  name: '03.Тубировка крем',
  producesMass: false,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('createWorkCenter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects empty code', async () => {
    const { createWorkCenter } = await import('../actions');
    await expect(createWorkCenter({ code: '   ', name: 'Name' })).rejects.toThrow('Код обязателен');
  });

  it('rejects duplicate code', async () => {
    const { prisma } = await import('@prodtrack/db');
    (prisma.workCenter.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(base);
    const { createWorkCenter } = await import('../actions');
    await expect(createWorkCenter({ code: '03', name: 'Other' })).rejects.toThrow('РЦ с таким кодом уже существует');
  });

  it('creates РЦ with producesMass=true for code 01', async () => {
    const { prisma, writeAudit } = await import('@prodtrack/db');
    (prisma.workCenter.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$transaction = vi.fn(async (cb: (tx: any) => any) => {
      const mockTx = {
        workCenter: {
          create: vi.fn().mockResolvedValue({ id: 'new', code: '01', name: '01.Реактор', producesMass: true, active: true }),
        },
      };
      return cb(mockTx);
    });
    const { createWorkCenter } = await import('../actions');
    const created = await createWorkCenter({ code: '01', name: '01.Реактор' });
    expect(created.producesMass).toBe(true);
    expect(writeAudit).toHaveBeenCalled();
    const auditCall = (writeAudit as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(auditCall.userRoles).toEqual(['ADM']);
    expect(auditCall.permission).toBe('nsi:manage');
  });

  it('creates РЦ with producesMass=false for code 03', async () => {
    const { prisma } = await import('@prodtrack/db');
    (prisma.workCenter.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$transaction = vi.fn(async (cb: (tx: any) => any) => {
      const mockTx = {
        workCenter: {
          create: vi.fn().mockResolvedValue({ id: 'new', code: '03', name: '03.Тубировка крем', producesMass: false, active: true }),
        },
      };
      return cb(mockTx);
    });
    const { createWorkCenter } = await import('../actions');
    const created = await createWorkCenter({ code: '03', name: '03.Тубировка крем' });
    expect(created.producesMass).toBe(false);
  });
});

describe('updateWorkCenter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks duplicate code on another record', async () => {
    const { prisma } = await import('@prodtrack/db');
    (prisma.workCenter.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ ...base, id: 'other-id' });
    const { updateWorkCenter } = await import('../actions');
    await expect(updateWorkCenter('wc-1', { code: '03', name: 'X' })).rejects.toThrow('РЦ с таким кодом уже существует');
  });

  it('updates producesMass when code changes to 02', async () => {
    const { prisma, writeAudit } = await import('@prodtrack/db');
    (prisma.workCenter.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.workCenter.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({ ...base, code: '03' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$transaction = vi.fn(async (cb: (tx: any) => any) => {
      const mockTx = {
        workCenter: {
          update: vi.fn().mockResolvedValue({ ...base, code: '02', name: '02.Миксер', producesMass: true }),
        },
      };
      return cb(mockTx);
    });
    const { updateWorkCenter } = await import('../actions');
    const updated = await updateWorkCenter('wc-1', { code: '02', name: '02.Миксер' });
    expect(updated.producesMass).toBe(true);
    expect(writeAudit).toHaveBeenCalled();
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

    const warnings = await getDeactivationWarnings('wc-1');

    expect(requirePermission).toHaveBeenCalledWith('nsi:manage');
    expect(dbWarnings).toHaveBeenCalledWith('WorkCenter', 'wc-1');
    expect(warnings).toHaveLength(1);
  });
});