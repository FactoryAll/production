import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@prodtrack/db';
import { requireAnyPermission } from '@/lib/auth/access';
import {
  ONE_C_PAGE_SIZE,
  getOneCTaskById,
  getOneCTasksPage,
  oneCWhere,
  parseOneCStatusFilter,
  parseOneCTypeFilter,
} from '../queries';

vi.mock('@prodtrack/db', () => ({
  prisma: {
    taskForOneC: { findMany: vi.fn(), findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

vi.mock('@/lib/auth/access', () => ({
  requireAnyPermission: vi.fn(),
}));

const productionData = {
  taskType: 'PRODUCTION',
  productionOrderId: 'po-1',
  shiftNumber: 1,
  shiftDate: '2026-10-06',
  completedAt: '2026-10-06T20:15:00.000Z',
  output: [],
  consumption: [],
};

function makeRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    type: 'PRODUCTION',
    sourceId: 'po-1',
    sourceType: 'PRODUCTION_ORDER',
    status: 'PENDING',
    data: productionData,
    processedAt: null,
    processedById: null,
    lastChangedAt: new Date('2026-10-06T20:15:00.000Z'),
    createdAt: new Date('2026-10-06T20:15:00.000Z'),
    ...overrides,
  };
}

describe('фильтры рабочего места 1С (M12 §8, BR-7)', () => {
  it('разбирает тип задачи, неизвестное значение → «все»', () => {
    expect(parseOneCTypeFilter('PRODUCTION')).toBe('PRODUCTION');
    expect(parseOneCTypeFilter('TRANSFER')).toBe('TRANSFER');
    expect(parseOneCTypeFilter('UNKNOWN')).toBe('ALL');
    expect(parseOneCTypeFilter(undefined)).toBe('ALL');
  });

  it('разбирает статус задачи, неизвестное значение → «все»', () => {
    expect(parseOneCStatusFilter('PENDING')).toBe('PENDING');
    expect(parseOneCStatusFilter('PROCESSED')).toBe('PROCESSED');
    expect(parseOneCStatusFilter('CANCELLED')).toBe('ALL');
    expect(parseOneCStatusFilter(undefined)).toBe('ALL');
  });

  it('собирает условие выборки только по заданным фильтрам', () => {
    expect(oneCWhere({})).toEqual({});
    expect(oneCWhere({ type: 'ALL', status: 'ALL' })).toEqual({});
    expect(oneCWhere({ type: 'TRANSFER', status: 'PENDING' })).toEqual({
      type: 'TRANSFER',
      status: 'PENDING',
    });
  });
});

describe('getOneCTasksPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.taskForOneC.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('требует право onec:read', async () => {
    await getOneCTasksPage({});
    expect(requireAnyPermission).toHaveBeenCalledWith(['onec:read']);
  });

  it('сортирует необработанные вперёд и отдаёт страницу без отдельного count', async () => {
    (prisma.taskForOneC.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([makeRecord()]);

    const result = await getOneCTasksPage({ type: 'PRODUCTION' }, '2');

    expect(prisma.taskForOneC.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { type: 'PRODUCTION' },
        orderBy: [{ status: 'asc' }, { lastChangedAt: 'desc' }],
        skip: ONE_C_PAGE_SIZE,
        take: ONE_C_PAGE_SIZE + 1,
      }),
    );
    expect(result.page).toBe(2);
    expect(result.items[0].data?.taskType).toBe('PRODUCTION');
  });

  it('определяет наличие следующей страницы по лишней записи', async () => {
    (prisma.taskForOneC.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeRecord({ id: 'task-1' }),
      makeRecord({ id: 'task-2' }),
    ]);

    const result = await getOneCTasksPage({}, undefined);

    expect(result.hasNextPage).toBe(false);
    expect(result.items).toHaveLength(2);
  });

  it('не падает на нераспознанных данных задачи', async () => {
    (prisma.taskForOneC.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeRecord({ data: { unexpected: true } }),
    ]);

    const result = await getOneCTasksPage({});

    expect(result.items[0].data).toBeNull();
  });
});

describe('getOneCTaskById', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('возвращает null, если задачи нет', async () => {
    (prisma.taskForOneC.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await expect(getOneCTaskById('missing')).resolves.toBeNull();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('показывает логин С1С, поставившего отметку «обработано» (BR-4)', async () => {
    (prisma.taskForOneC.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeRecord({ status: 'PROCESSED', processedAt: new Date('2026-10-06T21:00:00.000Z'), processedById: 'user-s1c' }),
    );
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ login: 's1c' });

    const detail = await getOneCTaskById('task-1');

    expect(detail?.processedByLogin).toBe('s1c');
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-s1c' },
      select: { login: true },
    });
  });
});
