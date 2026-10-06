import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@prodtrack/db', () => ({
  prisma: {
    workCenter: { findMany: vi.fn() },
    product: { findMany: vi.fn() },
    employee: { findMany: vi.fn() },
  },
  writeAudit: vi.fn(),
  writeTiming: vi.fn(),
  // T-075: форма ПЗ получает расписание смен и значения по умолчанию из @prodtrack/db.
  SHIFT_TIMES: {
    1: { start: '08:00', end: '20:00' },
    2: { start: '20:00', end: '08:00' },
  },
  localDateKey: () => '2026-10-06',
  currentShiftNumber: () => 1,
  parseShiftTarget: vi.fn(),
  resolveShiftId: vi.fn(),
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

function employee(id: string, fullName: string, overrides: Partial<Employee> = {}): Employee {
  return {
    id,
    tabNumber: id,
    fullName,
    active: true,
    canBeWorker: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** Оператор: есть активная учётная запись роли ОПР. */
const operator = employee('emp-opr', 'Оператор О.О.');
/** Работник РЦ без учётной записи — Оператором быть не может, работником может. */
const worker = employee('emp-worker', 'Рабочий Р.Р.');
/** Кладовщик: допуска работником РЦ нет (T-071). */
const storekeeper = employee('emp-store', 'Складчиков С.С.', { canBeWorker: false });

describe('getProductionOrderCreateData: списки сотрудников (T-070, T-071)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requirePermission as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: 'u1', user: { roles: [] } });
    (prisma.workCenter.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.product.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.employee.findMany as ReturnType<typeof vi.fn>)
      // 1-й запрос — работники РЦ, 2-й — Операторы
      .mockResolvedValueOnce([operator, worker])
      .mockResolvedValueOnce([operator]);
  });

  it('требует право production_order:create', async () => {
    await getProductionOrderCreateData();

    expect(requirePermission).toHaveBeenCalledWith('production_order:create');
  });

  it('отдаёт раздельные списки для «Работников» и «Оператора»', async () => {
    const data = await getProductionOrderCreateData();

    expect(data.workerEmployees).toEqual([operator, worker]);
    expect(data.operatorEmployees).toEqual([operator]);
  });

  it('ограничивает список работников признаком «Может привлекаться работником РЦ» (T-071)', async () => {
    await getProductionOrderCreateData();

    expect(prisma.employee.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: { active: true, canBeWorker: true } }),
    );
  });

  it('ограничивает выбор Оператора активной учётной записью с ролью ОПР (T-070, M02 BR-1)', async () => {
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
