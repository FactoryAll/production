import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@prodtrack/db';

vi.mock('@prodtrack/db', () => ({
  prisma: {
    workCenter: { findMany: vi.fn() },
    defectReason: { findMany: vi.fn() },
    substitutionReason: { findMany: vi.fn() },
    warehouse: { findMany: vi.fn() },
    shift: { findMany: vi.fn() },
  },
}));

import { getWorkCenterPage, WORK_CENTERS_PAGE_SIZE, workCenterWhere } from '../work-centers/queries';
import { defectReasonWhere, getDefectReasonPage } from '../defect-reasons/queries';
import { getSubstitutionReasonPage, substitutionReasonWhere } from '../substitution-reasons/queries';
import { getWarehousePage, warehouseWhere } from '../warehouses/queries';
import { getShiftsPage, shiftWhere } from '../shifts/queries';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('справочники: серверный поиск (T-058, M01 §8)', () => {
  it('РЦ: поиск по коду и названию, фильтр активности', () => {
    expect(workCenterWhere({ q: 'реактор' })).toEqual({
      OR: [
        { code: { contains: 'реактор', mode: 'insensitive' } },
        { name: { contains: 'реактор', mode: 'insensitive' } },
      ],
    });
    expect(workCenterWhere({ active: 'INACTIVE' })).toEqual({ active: false });
  });

  it('причины брака: поиск по коду и названию', () => {
    expect(defectReasonWhere({ q: 'D-1' }).OR).toHaveLength(2);
  });

  it('причины ввода за Оператора: поиск по коду и названию', () => {
    expect(substitutionReasonWhere({ q: 'болезнь' }).OR).toHaveLength(2);
  });

  it('склады: поиск по названию и описанию', () => {
    expect(warehouseWhere({ q: 'склад' })).toEqual({
      OR: [
        { name: { contains: 'склад', mode: 'insensitive' } },
        { description: { contains: 'склад', mode: 'insensitive' } },
      ],
    });
  });

  it('смены: поиск по дате в формате ГГГГ-ММ-ДД', () => {
    const where = shiftWhere({ q: '2026-10-03' });
    expect(where.date).toEqual(new Date('2026-10-03'));
    expect(where.OR).toBeUndefined();
  });

  it('смены: поиск по номеру и фильтр активности', () => {
    expect(shiftWhere({ q: '2' })).toEqual({ number: 2 });
    expect(shiftWhere({ active: 'ACTIVE' })).toEqual({ active: true });
  });

  it('пустой поиск не накладывает условий', () => {
    expect(workCenterWhere({ q: '   ' })).toEqual({});
    expect(shiftWhere({})).toEqual({});
  });
});

describe('справочники: постраничная выборка (T-057)', () => {
  it('РЦ: сортировка по коду и страница с запасной записью', async () => {
    (prisma.workCenter.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await getWorkCenterPage({ q: '01' }, '2');

    expect(prisma.workCenter.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { code: { contains: '01', mode: 'insensitive' } },
          { name: { contains: '01', mode: 'insensitive' } },
        ],
      },
      orderBy: { code: 'asc' },
      skip: WORK_CENTERS_PAGE_SIZE,
      take: WORK_CENTERS_PAGE_SIZE + 1,
    });
    expect(result.page).toBe(2);
  });

  it('причины брака и ввода за Оператора сортируются по коду', async () => {
    (prisma.defectReason.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.substitutionReason.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await getDefectReasonPage({});
    await getSubstitutionReasonPage({});

    expect(prisma.defectReason.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { code: 'asc' } }),
    );
    expect(prisma.substitutionReason.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { code: 'asc' } }),
    );
  });

  it('склады сортируются по названию', async () => {
    (prisma.warehouse.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await getWarehousePage({});

    expect(prisma.warehouse.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { name: 'asc' } }),
    );
  });

  it('смены сортируются по дате вниз и номеру вверх', async () => {
    (prisma.shift.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await getShiftsPage({});

    expect(prisma.shift.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ date: 'desc' }, { number: 'asc' }] }),
    );
  });
});
