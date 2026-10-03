import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/page-guard', () => ({ checkPageAccess: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ requireSession: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@prodtrack/db', () => ({
  prisma: { auditRecord: { findMany: vi.fn() } },
  archiveOldAuditRecords: vi.fn(),
}));

import { checkPageAccess } from '@/lib/auth/page-guard';
import { prisma } from '@prodtrack/db';
import { AccessDenied } from '@/components/access-denied';
import AuditServerPage from '../page';

function mockAccess(roles: string[], allowed = true) {
  (checkPageAccess as ReturnType<typeof vi.fn>).mockResolvedValue({
    allowed,
    roles,
    session: { userId: 'user-1', user: { id: 'user-1', roles: roles.map((code) => ({ role: { code } })) } },
  });
}

describe('Экран «Аудит»: доступ и выборка (M13 §8, T-047)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.auditRecord.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('роль без права audit:read получает экран «Доступ запрещён», а не 500', async () => {
    mockAccess(['KSGP'], false);

    const element = await AuditServerPage({ searchParams: {} });

    expect(element.type).toBe(AccessDenied);
    expect(prisma.auditRecord.findMany).not.toHaveBeenCalled();
  });

  it('читает журнал с фильтром по объекту и страницей', async () => {
    mockAccess(['NP']);

    const element = await AuditServerPage({
      searchParams: { objectType: 'GoodsTransfer', objectId: 'tr-1', page: '2' },
    });

    expect(element.type).toBe('main');
    expect(prisma.auditRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { archived: false, objectType: 'GoodsTransfer', objectId: 'tr-1' },
        skip: 50,
        take: 51,
      }),
    );
  });

  it('АДМ с флагом «показать архив» видит архивные записи (BR-6)', async () => {
    mockAccess(['ADM']);

    await AuditServerPage({ searchParams: { showArchived: 'on' } });

    expect(prisma.auditRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it('для роли без прав АДМ флаг «показать архив» игнорируется', async () => {
    mockAccess(['NP']);

    await AuditServerPage({ searchParams: { showArchived: 'on' } });

    expect(prisma.auditRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { archived: false } }),
    );
  });
});
