import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@prodtrack/db';
import {
  AUDIT_PAGE_SIZE,
  auditWhere,
  getAuditRecords,
  getObjectHistory,
} from '../queries';

vi.mock('@prodtrack/db', () => ({
  prisma: {
    auditRecord: { findMany: vi.fn() },
  },
}));

describe('auditWhere (M13 §8, BR-6)', () => {
  it('по умолчанию скрывает архив', () => {
    expect(auditWhere({}, false)).toEqual({ archived: false });
  });

  it('АДМ с флагом «показать архив» получает архивные записи', () => {
    expect(auditWhere({ showArchived: true }, true)).toEqual({});
  });

  it('остальным ролям флаг «показать архив» не помогает (Р-16)', () => {
    expect(auditWhere({ showArchived: true }, false)).toEqual({ archived: false });
  });

  it('фильтрует по пользователю, объекту и типу объекта', () => {
    expect(
      auditWhere(
        { userId: 'user-1', objectType: 'GoodsTransfer', objectId: 'tr-1' },
        false,
      ),
    ).toEqual({
      archived: false,
      userId: 'user-1',
      objectType: 'GoodsTransfer',
      objectId: 'tr-1',
    });
  });

  it('фильтрует по периоду, включая конец дня окончания', () => {
    const where = auditWhere({ from: '2026-10-01', to: '2026-10-03' }, false);
    expect(where.createdAt).toEqual({
      gte: new Date('2026-10-01'),
      lte: new Date('2026-10-03T23:59:59.999Z'),
    });
  });

  it('поддерживает открытый период', () => {
    const where = auditWhere({ from: '2026-10-01' }, false);
    expect(where.createdAt).toEqual({ gte: new Date('2026-10-01') });
  });
});

describe('getAuditRecords', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('читает журнал по времени вниз и отдаёт логин пользователя', async () => {
    (prisma.auditRecord.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'a-1',
        userId: 'user-1',
        role: 'NP',
        action: 'UPDATE',
        objectType: 'ProductionOrder',
        objectId: 'po-1',
        field: 'status',
        oldValue: 'DRAFT',
        newValue: 'CONFIRMED',
        createdAt: new Date('2026-10-03T10:00:00.000Z'),
        archived: false,
        user: { login: 'ivanov' },
      },
    ]);

    const records = await getAuditRecords({ objectType: 'ProductionOrder' }, false);

    expect(prisma.auditRecord.findMany).toHaveBeenCalledWith({
      where: { archived: false, objectType: 'ProductionOrder' },
      orderBy: [{ createdAt: 'desc' }],
      include: { user: { select: { login: true } } },
      take: AUDIT_PAGE_SIZE,
    });
    expect(records[0]).toMatchObject({
      id: 'a-1',
      userLogin: 'ivanov',
      role: 'NP',
      createdAt: '2026-10-03T10:00:00.000Z',
      archived: false,
    });
  });
});

describe('getObjectHistory (M13 §8: вкладка «История»)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('показывает историю конкретного объекта без архивных записей', async () => {
    (prisma.auditRecord.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await getObjectHistory('GoodsTransfer', 'tr-1', false);

    expect(prisma.auditRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { archived: false, objectType: 'GoodsTransfer', objectId: 'tr-1' },
      }),
    );
  });
});
