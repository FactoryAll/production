import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@prodtrack/db', () => ({
  prisma: {
    shift: { findMany: vi.fn() },
    workCenter: { findMany: vi.fn() },
    product: { findMany: vi.fn() },
    employee: { findMany: vi.fn() },
  },
  writeAudit: vi.fn(),
  writeTiming: vi.fn(),
}));
vi.mock('@/lib/auth/access', () => ({
  requirePermission: vi.fn(),
  requireAnyPermission: vi.fn(),
  hasPermission: vi.fn(),
}));

import type { Employee } from '@prisma/client';
import { prisma } from '@prodtrack/db';
import { requirePermission } from '@/lib/auth/access';
import { getProductionOrderCreateData } from '../actions';

function employee(id: string, fullName: string): Employee {
  return { id, tabNumber: id, fullName, active: true, createdAt: new Date(), updatedAt: new Date() };
}

const operator = employee('emp-opr', 'Оператор О.О.');
const storekeeper = employee('emp-store', 'Складчиков С.С.');

describe('getProductionOrderCreateData: список Операторов (T-070)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requirePermission as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: 'u1', user: { roles: [] } });
    (prisma.shift.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.workCenter.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.product.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.employee.findMany as ReturnType<typeof vi.fn>)
      // 1-й запрос — все активные сотрудники для поля «Работники»
      .mockResolvedValueOnce([operator, storekeeper])
      // 2-й запрос — только сотрудники с активной учётной записью роли ОПР
      .mockResolvedValueOnce([operator]);
  });

  it('требует право production_order:create', async () => {
    await getProductionOrderCreateData();

    expect(requirePermission).toHaveBeenCalledWith('production_order:create');
  });

  it('отдаёт для «Работников» всех активных, а для «Оператора» — только с учётной записью ОПР', async () => {
    const data = await getProductionOrderCreateData();

    expect(data.employees).toEqual([operator, storekeeper]);
    expect(data.operatorEmployees).toEqual([operator]);
  });

  it('ограничивает выбор Оператора активной учётной записью с ролью ОПР (M02 BR-1)', async () => {
    await getProductionOrderCreateData();

    expect(prisma.employee.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          active: true,
          user: { active: true, roles: { some: { role: { code: 'OPR' } } } },
        },
      }),
    );
  });
});
