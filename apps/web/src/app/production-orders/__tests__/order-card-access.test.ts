import { describe, it, expect, vi, beforeEach } from 'vitest';

const requireAnyPermission = vi.fn();

vi.mock('@/lib/auth/access', () => ({
  requirePermission: vi.fn(),
  requireAnyPermission: (...args: unknown[]) => requireAnyPermission(...args),
  hasPermission: (roles: string[], permission: string) =>
    permission === 'production_order:read'
      ? roles.includes('NP') || roles.includes('ADM') || roles.includes('S1C')
      : roles.includes('OPR'),
}));

const findUnique = vi.fn();
vi.mock('@prodtrack/db', () => ({
  prisma: {
    productionOrder: { findUnique: (...args: unknown[]) => findUnique(...args) },
    defectReason: { findMany: vi.fn().mockResolvedValue([]) },
  },
  writeAudit: vi.fn(),
  writeTiming: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { getProductionOrderById } from '../actions';

function order() {
  return {
    id: 'po-1',
    status: 'CONFIRMED',
    lines: [
      { id: 'line-1', operatorId: 'emp-opr-1', workCenterId: 'wc-01' },
      { id: 'line-2', operatorId: 'emp-opr-2', workCenterId: 'wc-02' },
    ],
  };
}

function session(roles: string[], employeeId: string | null) {
  return {
    userId: 'user-1',
    user: { id: 'user-1', employeeId, roles: roles.map((code) => ({ role: { code } })) },
  };
}

describe('Карточка ПЗ и права (регресс: 500 при переходе из уведомления под ОПР)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUnique.mockResolvedValue(order());
  });

  it('НП видит ПЗ целиком', async () => {
    requireAnyPermission.mockResolvedValue(session(['NP'], null));

    const result = await getProductionOrderById('po-1');

    expect(result.order?.lines).toHaveLength(2);
  });

  it('ОПР видит только строки своего РЦ', async () => {
    requireAnyPermission.mockResolvedValue(session(['OPR'], 'emp-opr-1'));

    const result = await getProductionOrderById('po-1');

    expect(result.order?.lines).toHaveLength(1);
    expect(result.order?.lines[0].id).toBe('line-1');
  });

  it('ОПР не получает ПЗ чужого РЦ (страница отдаст 404, а не 500)', async () => {
    requireAnyPermission.mockResolvedValue(session(['OPR'], 'emp-other'));

    const result = await getProductionOrderById('po-1');

    expect(result.order).toBeNull();
  });

  it('запрос разрешён и по праву read_own (ОПР не получает Forbidden)', async () => {
    requireAnyPermission.mockResolvedValue(session(['OPR'], 'emp-opr-1'));

    await getProductionOrderById('po-1');

    expect(requireAnyPermission).toHaveBeenCalledWith([
      'production_order:read',
      'production_order:read_own',
    ]);
  });
});
