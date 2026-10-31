import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

vi.mock('@/lib/auth/page-guard', () => ({ checkPageAccess: vi.fn() }));
vi.mock('@/lib/reports/defect-stops-report', async () => {
  const actual = await vi.importActual<typeof import('@/lib/reports/defect-stops-report')>(
    '@/lib/reports/defect-stops-report',
  );
  return { ...actual, getDefectStopsReport: vi.fn() };
});
vi.mock('@prodtrack/db', () => ({
  prisma: {
    shift: { findMany: vi.fn() },
    productionOrder: { findFirst: vi.fn().mockResolvedValue(null) },
  },
}));

import { checkPageAccess } from '@/lib/auth/page-guard';
import { prisma } from '@prodtrack/db';
import { getDefectStopsReport } from '@/lib/reports/defect-stops-report';
import { AccessDenied } from '@/components/access-denied';
import DefectStopsPage from '../page';

/**
 * Экран «Брак и простои» (T-101, часть а).
 *
 * Владелец решил: одна страница с переключателем «По РЦ | По причинам», простои — по строке
 * один раз (с основного факта), брак без причины — строкой, простой на человека — только
 * оператору строки.
 */
function mockAccess(allowed = true) {
  (checkPageAccess as ReturnType<typeof vi.fn>).mockResolvedValue({
    allowed,
    roles: ['OTK'],
    session: { userId: 'user-1', user: { id: 'user-1', roles: [{ role: { code: 'OTK' } }] } },
  });
}

const REPORT = {
  workCenters: [
    {
      code: '03',
      name: 'Тубировка крем',
      output: { mass: 0, gp: 10, pf: 4 },
      defect: { mass: 0, gp: 2, pf: 0 },
      stopsCount: 2,
      stopsMinutes: 30,
      stopsHours: 0.5,
      linesWithStops: 1,
    },
  ],
  reasons: [
    { code: 'DEFECT_A', name: 'Брак A', defect: { mass: 0, gp: 2, pf: 0 }, workCenterCodes: ['03'] },
    { code: null, name: 'без причины', defect: { mass: 5, gp: 0, pf: 0 }, workCenterCodes: ['03'] },
  ],
  operatorStops: [
    { employeeId: 'emp-1', employeeName: 'Иванов И.И.', stopsMinutes: 30, stopsHours: 0.5 },
    { employeeId: null, employeeName: 'Без персональной привязки', stopsMinutes: 65, stopsHours: 1.1 },
  ],
  totals: {
    output: { mass: 0, gp: 10, pf: 4 },
    defect: { mass: 5, gp: 2, pf: 0 },
    stopsCount: 2,
    stopsMinutes: 95,
    stopsHours: 1.6,
    linesWithStops: 1,
    linesWithSecondaryStops: 0,
  },
};

describe('Экран «Брак и простои»', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.shift.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (getDefectStopsReport as ReturnType<typeof vi.fn>).mockResolvedValue(REPORT);
  });

  it('без права reports:read — экран «Доступ запрещён»', async () => {
    mockAccess(false);

    const element = await DefectStopsPage({ searchParams: {} });

    expect(element.type).toBe(AccessDenied);
    expect(getDefectStopsReport).not.toHaveBeenCalled();
  });

  it('по умолчанию разрез «По РЦ»: выпуск, брак, доля, простои минутами и часами', async () => {
    mockAccess();

    render((await DefectStopsPage({ searchParams: {} })) as never);

    expect(screen.getByText('По РЦ')).toBeTruthy();
    expect(screen.getByText('03 — Тубировка крем')).toBeTruthy();
    // Доля брака — внутри категории: 2 из 10 ГП = 20%. Значение есть и в строке РЦ,
    // и в итогах, поэтому проверяем наличие, а не единственность.
    expect(screen.getAllByText('ГП 20% · ПФ 0%').length).toBeGreaterThanOrEqual(1);
    // Минуты и часы рядом: «270 минут» требует счёта в голове. Часы встречаются
    // и в строке РЦ, и в блоке операторов — поэтому проверяем наличие.
    expect(screen.getAllByText('0.5').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('30').length).toBeGreaterThanOrEqual(1);
  });

  it('переключатель «По причинам» показывает причины, включая «без причины»', async () => {
    mockAccess();

    render((await DefectStopsPage({ searchParams: { view: 'reason' } })) as never);

    expect(screen.getByText('DEFECT_A — Брак A')).toBeTruthy();
    expect(screen.getByText('без причины')).toBeTruthy();
    expect(screen.queryByText('03 — Тубировка крем')).toBeNull();
  });

  it('блок простоя по операторам: оператор и «Без персональной привязки»', async () => {
    mockAccess();

    render((await DefectStopsPage({ searchParams: {} })) as never);

    expect(screen.getByText('Простой по операторам')).toBeTruthy();
    expect(screen.getByText('Иванов И.И.')).toBeTruthy();
    expect(screen.getByText('Без персональной привязки')).toBeTruthy();
    expect(screen.getByText(/работникам не приписывается/)).toBeTruthy();
  });

  it('итоги: всего простоев, часы и число строк с простоем', async () => {
    mockAccess();

    render((await DefectStopsPage({ searchParams: {} })) as never);

    const footer = screen.getByText('Итого').closest('tr') as HTMLElement;
    expect(within(footer).getByText('95')).toBeTruthy();
    expect(within(footer).getByText('1.6')).toBeTruthy();
  });

  it('ссылка выгрузки сохраняет период и разрез', async () => {
    mockAccess();

    render(
      (await DefectStopsPage({
        searchParams: { view: 'reason', period: 'day', from: '2026-10-12', to: '2026-10-18' },
      })) as never,
    );

    const href = screen.getByRole('link', { name: 'Выгрузить в Excel' }).getAttribute('href') ?? '';
    expect(href).toContain('period=day');
    expect(href).toContain('view=reason');
  });

  // Ожидаемый случай старых данных: основной факт пуст, минуты в неосновном. Пометка нужна,
  // чтобы это не читалось как потеря данных.
  it('показывает пометку про строки, где простой взят из неосновного факта', async () => {
    mockAccess();
    (getDefectStopsReport as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...REPORT,
      totals: { ...REPORT.totals, linesWithSecondaryStops: 3 },
    });

    render((await DefectStopsPage({ searchParams: {} })) as never);

    expect(screen.getByText(/У 3 строк\(-и\) простой записан в неосновной факт/)).toBeTruthy();
  });

  it('без таких строк пометки нет', async () => {
    mockAccess();

    render((await DefectStopsPage({ searchParams: {} })) as never);

    expect(screen.queryByText(/неосновной факт/)).toBeNull();
  });

  it('пустой период — понятные тексты в каждом разрезе', async () => {
    mockAccess();
    (getDefectStopsReport as ReturnType<typeof vi.fn>).mockResolvedValue({
      workCenters: [],
      reasons: [],
      operatorStops: [],
      totals: {
        output: { mass: 0, gp: 0, pf: 0 },
        defect: { mass: 0, gp: 0, pf: 0 },
        stopsCount: 0,
        stopsMinutes: 0,
        stopsHours: 0,
        linesWithStops: 0,
        linesWithSecondaryStops: 0,
      },
    });

    render((await DefectStopsPage({ searchParams: {} })) as never);
    expect(screen.getByText('За выбранный период данных нет.')).toBeTruthy();
  });
});
