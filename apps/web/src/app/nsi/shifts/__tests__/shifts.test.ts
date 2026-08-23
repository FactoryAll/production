import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Shift } from '@prisma/client';

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
          shift: {
            create: vi.fn(),
            update: vi.fn(),
            findUnique: vi.fn(),
            findUniqueOrThrow: vi.fn(),
          },
        };
        return cb(mockTx);
      }),
      shift: {
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

const base: Shift = {
  id: 'shift-1',
  number: 1,
  date: new Date(2026, 7, 22),
  start: '08:00',
  end: '20:00',
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('createShift', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects invalid shift number', async () => {
    const { createShift } = await import('../actions');
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createShift({ number: 3 as any, date: '2026-08-22' }),
    ).rejects.toThrow('Номер смены может быть только 1 или 2');
  });

  it('rejects duplicate number/date pair', async () => {
    const { prisma } = await import('@prodtrack/db');
    (prisma.shift.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(base);
    const { createShift } = await import('../actions');
    await expect(createShift({ number: 1, date: '2026-08-22' })).rejects.toThrow('Смена с таким номером и датой уже существует');
  });

  it('creates shift 1 with correct times and writes audit', async () => {
    const { prisma, writeAudit } = await import('@prodtrack/db');
    (prisma.shift.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma as unknown as { $transaction: (cb: (tx: { shift: { create: () => Promise<unknown> } }) => Promise<unknown>) => Promise<unknown> }).$transaction = vi.fn(async (cb) => {
      const mockTx = {
        shift: {
          create: vi.fn().mockResolvedValue({ ...base, id: 'new' }),
        },
      };
      return cb(mockTx);
    });
    const { createShift } = await import('../actions');
    const created = await createShift({ number: 1, date: '2026-08-22' });
    expect(created.start).toBe('08:00');
    expect(created.end).toBe('20:00');
    expect(writeAudit).toHaveBeenCalled();
    const auditCall = (writeAudit as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(auditCall.userRoles).toEqual(['ADM']);
    expect(auditCall.permission).toBe('nsi:manage');
    expect(auditCall.action).toBe('CREATE');
  });

  it('creates shift 2 with correct times', async () => {
    const { prisma } = await import('@prodtrack/db');
    (prisma.shift.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma as unknown as { $transaction: (cb: (tx: { shift: { create: () => Promise<unknown> } }) => Promise<unknown>) => Promise<unknown> }).$transaction = vi.fn(async (cb) => {
      const mockTx = {
        shift: {
          create: vi.fn().mockResolvedValue({ ...base, id: 'new', number: 2, start: '20:00', end: '08:00' }),
        },
      };
      return cb(mockTx);
    });
    const { createShift } = await import('../actions');
    const created = await createShift({ number: 2, date: '2026-08-22' });
    expect(created.start).toBe('20:00');
    expect(created.end).toBe('08:00');
  });
});

describe('updateShift', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('overwrites start/end when number changes', async () => {
    const { prisma, writeAudit } = await import('@prodtrack/db');
    (prisma.shift.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.shift.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(base);
    (prisma as unknown as { $transaction: (cb: (tx: { shift: { update: () => Promise<unknown> } }) => Promise<unknown>) => Promise<unknown> }).$transaction = vi.fn(async (cb) => {
      const mockTx = {
        shift: {
          update: vi.fn().mockResolvedValue({ ...base, number: 2, start: '20:00', end: '08:00' }),
        },
      };
      return cb(mockTx);
    });
    const { updateShift } = await import('../actions');
    const updated = await updateShift('shift-1', { number: 2, date: '2026-08-22' });
    expect(updated.number).toBe(2);
    expect(updated.start).toBe('20:00');
    expect(updated.end).toBe('08:00');
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
    const warnings = await getDeactivationWarnings('shift-1');
    expect(requirePermission).toHaveBeenCalled();
    expect(warnings).toEqual([]);
  });
});