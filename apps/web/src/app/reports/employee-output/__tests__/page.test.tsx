import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

vi.mock('@/lib/auth/page-guard', () => ({ checkPageAccess: vi.fn() }));
vi.mock('@/lib/reports/employee-output-report', async () => {
  const actual = await vi.importActual<typeof import('@/lib/reports/employee-output-report')>(
    '@/lib/reports/employee-output-report',
  );
  return {
    ...actual,
    getEmployeeOutputReport: vi.fn(),
  };
});
vi.mock('@prodtrack/db', () => ({
  prisma: {
    shift: { findMany: vi.fn() },
    productionOrder: { findFirst: vi.fn().mockResolvedValue(null) },
    workCenter: { findMany: vi.fn() },
  },
}));

import { checkPageAccess } from '@/lib/auth/page-guard';
import { prisma } from '@prodtrack/db';
import {
  WORKERS_SUM_NOTE,
  getEmployeeOutputReport,
} from '@/lib/reports/employee-output-report';
import { AccessDenied } from '@/components/access-denied';
import EmployeeOutputPage from '../page';

/**
 * Экран «Выработка по сотрудникам» (T-097, этап 3).
 *
 * Требования владельца: два блока в одной таблице, строка «Без персональной привязки» в каждом,
 * пояснение под таблицей из константы (а не придуманное в разметке), фильтр РЦ, выгрузка одним
 * файлом с колонкой «Блок» (проверяется в CSV отдельно).
 */
function mockAccess(allowed = true) {
  (checkPageAccess as ReturnType<typeof vi.fn>).mockResolvedValue({
    allowed,
    roles: ['OTK'],
    session: { userId: 'user-1', user: { id: 'user-1', roles: [{ role: { code: 'OTK' } }] } },
  });
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    block: 'OPERATOR',
    employeeId: 'emp-1',
    employeeName: 'Иванов И.И.',
    tabNumber: '0001',
    output: { mass: 0, gp: 10, pf: 4 },
    defect: { mass: 0, gp: 2, pf: 0 },
    lines: 1,
    orders: 1,
    ...overrides,
  };
}

const REPORT = {
  rows: [
    row(),
    row({ employeeId: null, employeeName: 'Без персональной привязки', tabNumber: null, output: { mass: 0, gp: 3, pf: 0 }, defect: { mass: 0, gp: 0, pf: 0 } }),
    row({ block: 'WORKER', employeeId: 'emp-2', employeeName: 'Петров П.П.', tabNumber: '0002', output: { mass: 0, gp: 10, pf: 4 }, defect: { mass: 0, gp: 1, pf: 0 } }),
    row({ block: 'WORKER', employeeId: null, employeeName: 'Без персональной привязки', tabNumber: null, output: { mass: 0, gp: 5, pf: 0 }, defect: { mass: 0, gp: 0, pf: 0 } }),
  ],
  operatorTotals: { output: { mass: 0, gp: 13, pf: 4 }, defect: { mass: 0, gp: 2, pf: 0 }, lines: 2, orders: 1 },
  workerTotals: { output: { mass: 0, gp: 15, pf: 4 }, defect: { mass: 0, gp: 1, pf: 0 }, lines: 2, orders: 1 },
};

describe('Экран «Выработка по сотрудникам»', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.shift.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.workCenter.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'wc-03', code: '03', name: 'Тубировка крем' },
    ]);
    (getEmployeeOutputReport as ReturnType<typeof vi.fn>).mockResolvedValue(REPORT);
  });

  it('без права reports:read — экран «Доступ запрещён»', async () => {
    mockAccess(false);

    const element = await EmployeeOutputPage({ searchParams: {} });

    expect(element.type).toBe(AccessDenied);
    expect(getEmployeeOutputReport).not.toHaveBeenCalled();
  });

  it('два блока: операторы и работники, «Без персональной привязки» — в каждом', async () => {
    mockAccess();

    render((await EmployeeOutputPage({ searchParams: {} })) as never);

    expect(screen.getByText('Операторы')).toBeTruthy();
    expect(screen.getByText('Работники')).toBeTruthy();
    // Строка «Без персональной привязки» — по одной в каждом блоке.
    expect(screen.getAllByText('Без персональной привязки')).toHaveLength(2);
  });

  it('выпуск по категориям и брак отдельными колонками, доля брака по категории', async () => {
    mockAccess();

    render((await EmployeeOutputPage({ searchParams: {} })) as never);

    // Имя и табельный в одной ячейке, но текстовыми узлами: ищем по частям.
    expect(screen.getByText(/Иванов И\.И\./)).toBeTruthy();
    expect(screen.getByText(/0001/)).toBeTruthy();
    // Доля брака: 2 из 10 ГП = 20% (по ГП, а не от суммы кг+шт).
    expect(screen.getByText('ГП 20% · ПФ 0%')).toBeTruthy();
  });

  it('пояснение под таблицей взято из расчёта, а не придумано в разметке', async () => {
    mockAccess();

    render((await EmployeeOutputPage({ searchParams: {} })) as never);

    expect(screen.getByText(WORKERS_SUM_NOTE)).toBeTruthy();
    expect(WORKERS_SUM_NOTE).toContain('один факт зачтён каждому работнику');
  });

  it('фильтр РЦ уходит в расчёт и остаётся в ссылке выгрузки', async () => {
    mockAccess();

    render(
      (await EmployeeOutputPage({
        searchParams: { workCenterId: 'wc-03', period: 'day', from: '2026-10-12', to: '2026-10-18' },
      })) as never,
    );

    expect(getEmployeeOutputReport).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { workCenterId: 'wc-03' },
    );

    const exportLink = screen.getByRole('link', { name: 'Выгрузить в Excel' });
    const href = exportLink.getAttribute('href') ?? '';
    expect(href).toContain('workCenterId=wc-03');
    expect(href).toContain('period=day');
    expect(href).toContain('from=2026-10-12');
    expect(href).toContain('to=2026-10-18');
  });

  it('фильтр РЦ присутствует в общей форме периода', async () => {
    mockAccess();

    render((await EmployeeOutputPage({ searchParams: {} })) as never);

    const select = screen.getByLabelText('РЦ') as HTMLSelectElement;
    expect(within(select).getByText('Все РЦ')).toBeTruthy();
  });

  it('пустой период — понятный текст в каждом блоке', async () => {
    mockAccess();
    (getEmployeeOutputReport as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [],
      operatorTotals: { output: { mass: 0, gp: 0, pf: 0 }, defect: { mass: 0, gp: 0, pf: 0 }, lines: 0, orders: 0 },
      workerTotals: { output: { mass: 0, gp: 0, pf: 0 }, defect: { mass: 0, gp: 0, pf: 0 }, lines: 0, orders: 0 },
    });

    render((await EmployeeOutputPage({ searchParams: {} })) as never);

    expect(screen.getAllByText('За выбранный период выпуска нет.')).toHaveLength(2);
  });
});
