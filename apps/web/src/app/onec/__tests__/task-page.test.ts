import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/page-guard', () => ({ checkPageAccess: vi.fn() }));
vi.mock('@/lib/auth/access', () => ({ requireAnyPermission: vi.fn() }));
vi.mock('@prodtrack/db', () => ({
  prisma: { taskForOneC: { findMany: vi.fn(), findUnique: vi.fn() }, user: { findUnique: vi.fn() } },
}));

import { checkPageAccess } from '@/lib/auth/page-guard';
import { prisma } from '@prodtrack/db';
import { AccessDenied } from '@/components/access-denied';
import OneCTaskServerPage from '../[id]/page';

function mockAccess(allowed = true, roles: string[] = ['S1C']) {
  (checkPageAccess as ReturnType<typeof vi.fn>).mockResolvedValue({
    allowed,
    roles,
    session: { userId: 'user-1', user: { id: 'user-1', roles: roles.map((code) => ({ role: { code } })) } },
  });
}

const record = {
  id: 'task-1',
  type: 'PRODUCTION',
  sourceId: 'po-1',
  sourceType: 'PRODUCTION_ORDER',
  status: 'PENDING',
  data: {
    taskType: 'PRODUCTION',
    productionOrderId: 'po-1',
    shiftNumber: 1,
    shiftDate: '2026-10-06',
    completedAt: null,
    output: [],
    consumption: [],
  },
  processedAt: null,
  processedById: null,
  lastChangedAt: new Date('2026-10-06T20:15:00.000Z'),
  createdAt: new Date('2026-10-06T20:15:00.000Z'),
};

describe('Карточка задачи для 1С (T-051, UC-M12-2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.taskForOneC.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(record);
  });

  it('роль без права onec:read получает экран «Доступ запрещён»', async () => {
    mockAccess(false, ['OPR']);

    const element = await OneCTaskServerPage({ params: { id: 'task-1' } });

    expect(element.type).toBe(AccessDenied);
    expect(prisma.taskForOneC.findUnique).not.toHaveBeenCalled();
  });

  it('показывает карточку задачи с реквизитами источника', async () => {
    mockAccess();

    const element = await OneCTaskServerPage({ params: { id: 'task-1' } });

    expect(element.type).toBe('main');
    expect(prisma.taskForOneC.findUnique).toHaveBeenCalledWith({ where: { id: 'task-1' } });
  });

  it('отдаёт понятный экран для несуществующей задачи вместо 500', async () => {
    mockAccess();
    (prisma.taskForOneC.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const element = await OneCTaskServerPage({ params: { id: 'missing' } });

    expect(element.type).toBe('main');
  });
});
