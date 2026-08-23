import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SubstitutionReason as PrismaSubstitutionReason } from '@prisma/client';
import { SubstitutionReason } from '@prodtrack/contracts';

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
          substitutionReason: {
            create: vi.fn(),
            update: vi.fn(),
            findUnique: vi.fn(),
            findUniqueOrThrow: vi.fn(),
          },
        };
        return cb(mockTx);
      }),
      substitutionReason: {
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(),
      },
    },
    writeAudit: vi.fn(),
  };
});

vi.mock('@/lib/auth/access', () => ({
  requirePermission: vi.fn().mockResolvedValue({ userId: 'admin-user' } as any),
}));

const base: PrismaSubstitutionReason = {
  id: 'sr-1',
  code: SubstitutionReason.ILLNESS,
  name: 'Болезнь',
  active: true,
};

describe('createSubstitutionReason', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects invalid code', async () => {
    const { createSubstitutionReason } = await import('../actions');
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createSubstitutionReason({ code: 'INVALID' as any, name: 'Name' }),
    ).rejects.toThrow('Код причины должен быть из списка');
  });

  it('rejects empty name', async () => {
    const { createSubstitutionReason } = await import('../actions');
    await expect(createSubstitutionReason({ code: SubstitutionReason.NO_SHOW, name: '' })).rejects.toThrow('Наименование обязательно');
  });

  it('rejects duplicate code', async () => {
    const { prisma } = await import('@prodtrack/db');
    (prisma.substitutionReason.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(base);
    const { createSubstitutionReason } = await import('../actions');
    await expect(createSubstitutionReason({ code: SubstitutionReason.ILLNESS, name: 'Other' })).rejects.toThrow('Причина ввода за Оператора с таким кодом уже существует');
  });

  it('creates substitution reason and writes audit', async () => {
    const { prisma, writeAudit } = await import('@prodtrack/db');
    (prisma.substitutionReason.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma as unknown as { $transaction: (cb: (tx: { substitutionReason: { create: () => Promise<unknown> } }) => Promise<unknown>) => Promise<unknown> }).$transaction = vi.fn(async (cb) => {
      const mockTx = {
        substitutionReason: {
          create: vi.fn().mockResolvedValue({ id: 'new', code: SubstitutionReason.OTHER, name: 'Прочее', active: true }),
        },
      };
      return cb(mockTx);
    });
    const { createSubstitutionReason } = await import('../actions');
    const created = await createSubstitutionReason({ code: SubstitutionReason.OTHER, name: 'Прочее' });
    expect(created.code).toBe(SubstitutionReason.OTHER);
    expect(writeAudit).toHaveBeenCalled();
    const auditCall = (writeAudit as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(auditCall.role).toBe('ADM');
    expect(auditCall.action).toBe('CREATE');
  });
});

describe('updateSubstitutionReason', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks duplicate code on another record', async () => {
    const { prisma } = await import('@prodtrack/db');
    (prisma.substitutionReason.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ ...base, id: 'other-id' });
    const { updateSubstitutionReason } = await import('../actions');
    await expect(updateSubstitutionReason('sr-1', { code: SubstitutionReason.ILLNESS, name: 'X' })).rejects.toThrow('Причина ввода за Оператора с таким кодом уже существует');
  });

  it('updates substitution reason and writes audit', async () => {
    const { prisma, writeAudit } = await import('@prodtrack/db');
    (prisma.substitutionReason.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.substitutionReason.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(base);
    (prisma as unknown as { $transaction: (cb: (tx: { substitutionReason: { update: () => Promise<unknown> } }) => Promise<unknown>) => Promise<unknown> }).$transaction = vi.fn(async (cb) => {
      const mockTx = {
        substitutionReason: {
          update: vi.fn().mockResolvedValue({ ...base, code: SubstitutionReason.LEFT_SHIFT, name: 'Ушёл' }),
        },
      };
      return cb(mockTx);
    });
    const { updateSubstitutionReason } = await import('../actions');
    const updated = await updateSubstitutionReason('sr-1', { code: SubstitutionReason.LEFT_SHIFT, name: 'Ушёл' });
    expect(updated.name).toBe('Ушёл');
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
    const warnings = await getDeactivationWarnings('sr-1');
    expect(requirePermission).toHaveBeenCalled();
    expect(warnings).toEqual([]);
  });
});
