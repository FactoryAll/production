import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DefectReason } from '@prisma/client';

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
          defectReason: {
            create: vi.fn(),
            update: vi.fn(),
            findUnique: vi.fn(),
            findUniqueOrThrow: vi.fn(),
          },
        };
        return cb(mockTx);
      }),
      defectReason: {
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(),
      },
    },
    writeAudit: vi.fn(),
  };
});

vi.mock('@/lib/auth/access', () => ({
  requirePermission: vi.fn().mockResolvedValue({ userId: 'admin-user', user: { roles: [{ role: { code: 'ADM' } }] } } as any),
}));

const base: DefectReason = {
  id: 'dr-1',
  code: 'DEFECT_A',
  name: 'Брак A',
  active: true,
};

describe('createDefectReason', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects empty code', async () => {
    const { createDefectReason } = await import('../actions');
    await expect(createDefectReason({ code: '   ', name: 'Name' })).rejects.toThrow('Код обязателен');
  });

  it('rejects empty name', async () => {
    const { createDefectReason } = await import('../actions');
    await expect(createDefectReason({ code: 'X', name: '' })).rejects.toThrow('Наименование обязательно');
  });

  it('rejects duplicate code', async () => {
    const { prisma } = await import('@prodtrack/db');
    (prisma.defectReason.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(base);
    const { createDefectReason } = await import('../actions');
    await expect(createDefectReason({ code: 'DEFECT_A', name: 'Other' })).rejects.toThrow('Причина брака с таким кодом уже существует');
  });

  it('creates defect reason and writes audit', async () => {
    const { prisma, writeAudit } = await import('@prodtrack/db');
    (prisma.defectReason.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma as unknown as { $transaction: (cb: (tx: { defectReason: { create: () => Promise<unknown> } }) => Promise<unknown>) => Promise<unknown> }).$transaction = vi.fn(async (cb) => {
      const mockTx = {
        defectReason: {
          create: vi.fn().mockResolvedValue({ id: 'new', code: 'DEFECT_B', name: 'Брак B', active: true }),
        },
      };
      return cb(mockTx);
    });
    const { createDefectReason } = await import('../actions');
    const created = await createDefectReason({ code: 'DEFECT_B', name: 'Брак B' });
    expect(created.code).toBe('DEFECT_B');
    expect(writeAudit).toHaveBeenCalled();
    const auditCall = (writeAudit as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(auditCall.userRoles).toEqual(['ADM']);
    expect(auditCall.permission).toBe('nsi:manage');
    expect(auditCall.action).toBe('CREATE');
  });
});

describe('updateDefectReason', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks duplicate code on another record', async () => {
    const { prisma } = await import('@prodtrack/db');
    (prisma.defectReason.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ ...base, id: 'other-id' });
    const { updateDefectReason } = await import('../actions');
    await expect(updateDefectReason('dr-1', { code: 'DEFECT_A', name: 'X' })).rejects.toThrow('Причина брака с таким кодом уже существует');
  });

  it('updates defect reason and writes audit', async () => {
    const { prisma, writeAudit } = await import('@prodtrack/db');
    (prisma.defectReason.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.defectReason.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(base);
    (prisma as unknown as { $transaction: (cb: (tx: { defectReason: { update: () => Promise<unknown> } }) => Promise<unknown>) => Promise<unknown> }).$transaction = vi.fn(async (cb) => {
      const mockTx = {
        defectReason: {
          update: vi.fn().mockResolvedValue({ ...base, code: 'DEFECT_C', name: 'Брак C' }),
        },
      };
      return cb(mockTx);
    });
    const { updateDefectReason } = await import('../actions');
    const updated = await updateDefectReason('dr-1', { code: 'DEFECT_C', name: 'Брак C' });
    expect(updated.name).toBe('Брак C');
    expect(writeAudit).toHaveBeenCalled();
  });
});

describe('UC-M01-2: deactivation warnings (Phase 2/3 stub)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getDeactivationWarnings requires admin and returns empty list', async () => {
    const { requirePermission } = await import('@/lib/auth/access');
    const { getDeactivationWarnings } = await import('../actions');
    const warnings = await getDeactivationWarnings('dr-1');
    expect(requirePermission).toHaveBeenCalled();
    expect(warnings).toEqual([]);
  });
});