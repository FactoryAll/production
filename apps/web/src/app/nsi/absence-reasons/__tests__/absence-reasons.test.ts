import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AbsenceReason as PrismaAbsenceReason } from '@prisma/client';

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
          absenceReason: {
            create: vi.fn(),
            update: vi.fn(),
            findUnique: vi.fn(),
            findUniqueOrThrow: vi.fn(),
          },
        };
        return cb(mockTx);
      }),
      absenceReason: {
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
  requirePermission: vi
    .fn()
    .mockResolvedValue({
      userId: 'admin-user',
      user: { roles: [{ role: { code: 'ADM' } }] },
    } as never),
}));

const base: PrismaAbsenceReason = {
  id: 'ar-1',
  code: 'ILLNESS',
  name: 'Болезнь',
  active: true,
};

describe('createAbsenceReason (T-093: справочник причин неявки)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('требует непустой код', async () => {
    const { createAbsenceReason } = await import('../actions');
    await expect(createAbsenceReason({ code: '   ', name: 'Болезнь' })).rejects.toThrow(
      'Код обязателен',
    );
  });

  it('требует наименование', async () => {
    const { createAbsenceReason } = await import('../actions');
    await expect(createAbsenceReason({ code: 'ILLNESS', name: '  ' })).rejects.toThrow(
      'Наименование обязательно',
    );
  });

  it('не даёт завести второй код', async () => {
    const { prisma } = await import('@prodtrack/db');
    (prisma.absenceReason.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(base);
    const { createAbsenceReason } = await import('../actions');
    await expect(createAbsenceReason({ code: 'ILLNESS', name: 'Другое' })).rejects.toThrow(
      'Причина неявки с таким кодом уже существует',
    );
  });

  it('создаёт причину и пишет аудит с правом nsi:manage', async () => {
    const { prisma, writeAudit } = await import('@prodtrack/db');
    (prisma.absenceReason.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (
      prisma as unknown as {
        $transaction: (
          cb: (tx: { absenceReason: { create: () => Promise<unknown> } }) => Promise<unknown>,
        ) => Promise<unknown>;
      }
    ).$transaction = vi.fn(async (cb) => {
      const mockTx = {
        absenceReason: {
          create: vi
            .fn()
            .mockResolvedValue({ id: 'new', code: 'ABSENTEEISM', name: 'Прогул', active: true }),
        },
      };
      return cb(mockTx);
    });

    const { createAbsenceReason } = await import('../actions');
    const created = await createAbsenceReason({ code: 'ABSENTEEISM', name: 'Прогул' });

    expect(created.code).toBe('ABSENTEEISM');
    const auditCall = (writeAudit as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(auditCall.objectType).toBe('AbsenceReason');
    expect(auditCall.action).toBe('CREATE');
    expect(auditCall.userRoles).toEqual(['ADM']);
    expect(auditCall.permission).toBe('nsi:manage');
  });
});

describe('updateAbsenceReason', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('не даёт занять код другой причины', async () => {
    const { prisma } = await import('@prodtrack/db');
    (prisma.absenceReason.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...base,
      id: 'other-id',
    });
    const { updateAbsenceReason } = await import('../actions');
    await expect(updateAbsenceReason('ar-1', { code: 'ILLNESS', name: 'X' })).rejects.toThrow(
      'Причина неявки с таким кодом уже существует',
    );
  });

  it('правит наименование и пишет «было → стало»', async () => {
    const { prisma, writeAudit } = await import('@prodtrack/db');
    (prisma.absenceReason.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.absenceReason.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(base);
    (
      prisma as unknown as {
        $transaction: (
          cb: (tx: { absenceReason: { update: () => Promise<unknown> } }) => Promise<unknown>,
        ) => Promise<unknown>;
      }
    ).$transaction = vi.fn(async (cb) => {
      const mockTx = {
        absenceReason: {
          update: vi.fn().mockResolvedValue({ ...base, name: 'Болезнь (подтверждённая)' }),
        },
      };
      return cb(mockTx);
    });

    const { updateAbsenceReason } = await import('../actions');
    const updated = await updateAbsenceReason('ar-1', {
      code: 'ILLNESS',
      name: 'Болезнь (подтверждённая)',
    });

    expect(updated.name).toBe('Болезнь (подтверждённая)');
    const auditCall = (writeAudit as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(auditCall.oldValue).toContain('Болезнь');
    expect(auditCall.newValue).toContain('Болезнь (подтверждённая)');
  });
});

describe('деактивация причины неявки (Р-22)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('запрашивает незавершённые документы по типу AbsenceReason', async () => {
    const { requirePermission } = await import('@/lib/auth/access');
    const { getDeactivationWarnings: dbWarnings } = await import('@prodtrack/db');
    (dbWarnings as ReturnType<typeof vi.fn>).mockResolvedValue([
      { type: 'PRODUCTION_ORDER', id: 'po-1', label: 'ПЗ po-1 · В работе' },
    ]);

    const { getDeactivationWarnings } = await import('../actions');
    const warnings = await getDeactivationWarnings('ar-1');

    expect(requirePermission).toHaveBeenCalledWith('nsi:manage');
    expect(dbWarnings).toHaveBeenCalledWith('AbsenceReason', 'ar-1');
    expect(warnings).toHaveLength(1);
  });

  it('переключает активность и пишет аудит поля active', async () => {
    const { prisma, writeAudit } = await import('@prodtrack/db');
    (prisma.absenceReason.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(base);
    (
      prisma as unknown as {
        $transaction: (
          cb: (tx: { absenceReason: { update: () => Promise<unknown> } }) => Promise<unknown>,
        ) => Promise<unknown>;
      }
    ).$transaction = vi.fn(async (cb) => {
      const mockTx = {
        absenceReason: { update: vi.fn().mockResolvedValue({ ...base, active: false }) },
      };
      return cb(mockTx);
    });

    const { toggleAbsenceReasonActive } = await import('../actions');
    const updated = await toggleAbsenceReasonActive('ar-1');

    expect(updated.active).toBe(false);
    const auditCall = (writeAudit as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(auditCall.field).toBe('active');
    expect(auditCall.oldValue).toBe('true');
    expect(auditCall.newValue).toBe('false');
  });
});
