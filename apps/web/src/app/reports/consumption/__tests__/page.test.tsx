import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/auth/page-guard', () => ({ checkPageAccess: vi.fn() }));
vi.mock('@/lib/reports/consumption-report', async () => {
  const actual = await vi.importActual<typeof import('@/lib/reports/consumption-report')>(
    '@/lib/reports/consumption-report'
  );
  return { ...actual, getConsumptionReport: vi.fn() };
});
vi.mock('@prodtrack/db', () => ({
  prisma: {
    shift: { findMany: vi.fn() },
    productionOrder: { findFirst: vi.fn().mockResolvedValue(null) },
    workCenter: { findMany: vi.fn() },
    product: { findMany: vi.fn() }
  }
}));

import { checkPageAccess } from '@/lib/auth/page-guard';
import { prisma } from '@prodtrack/db';
import { SECONDARY_CONSUMPTION_NOTE, getConsumptionReport } from '@/lib/reports/consumption-report';
import { AccessDenied } from '@/components/access-denied';
import ConsumptionPage from '../page';

/**
 * Экран «Потребление» (T-098).
 *
 * Владелец решил: два разреза на одной странице, фильтр по номенклатуре, РЦ виден в разрезе
 * по номенклатуре (это и есть отличие от T-096), счётчик «не в основном факте» — в подписи
 * и в CSV, выгрузка одним файлом с колонкой «Разрез».
 */
function mockAccess(allowed = true) {
  (checkPageAccess as ReturnType<typeof vi.fn>).mockResolvedValue({
    allowed,
    roles: ['OTK'],
    session: { userId: 'user-1', user: { id: 'user-1', roles: [{ role: { code: 'OTK' } }] } }
  });
}

const REPORT = {
  workCenters: [
    {
      workCenterCode: '03',
      workCenterName: 'Тубировка крем',
      productCode: 'MAT100',
      productName: 'Крем',
      productUnit: 'кг',
      stockCategory: 'MASS',
      quantity: 120,
      lines: 2
    }
  ],
  products: [
    {
      productCode: 'MAT100',
      productName: 'Крем',
      productUnit: 'кг',
      stockCategory: 'MASS',
      quantity: 120,
      lines: 2,
      workCenterCodes: ['03', '05']
    }
  ],
  totals: { byCategory: { MASS: 120, PF: 0, GP: 0 }, lines: 2, linesWithSecondaryConsumption: 0 }
};

describe('Экран «Потребление»', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.shift.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.workCenter.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'wc-03', code: '03', name: 'Тубировка крем' }
    ]);
    (prisma.product.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'mat-100', code: 'MAT100', name: 'Крем' }
    ]);
    (getConsumptionReport as ReturnType<typeof vi.fn>).mockResolvedValue(REPORT);
  });

  it('без права reports:read — экран «Доступ запрещён»', async () => {
    mockAccess(false);

    const element = await ConsumptionPage({ searchParams: {} });

    expect(element.type).toBe(AccessDenied);
    expect(getConsumptionReport).not.toHaveBeenCalled();
  });

  it('по умолчанию разрез «По РЦ»: РЦ, номенклатура, категория остатка, количество', async () => {
    mockAccess();

    render((await ConsumptionPage({ searchParams: {} })) as never);

    const table = screen.getByRole('table');
    expect(within(table).getByText('03 — Тубировка крем')).toBeTruthy();
    expect(within(table).getByText('MAT100 — Крем')).toBeTruthy();
    expect(screen.getByText('Масса')).toBeTruthy();
    expect(screen.getByText('120 кг')).toBeTruthy();
  });

  it('разрез «По номенклатуре» показывает РЦ — отличие от «Движения склада»', async () => {
    mockAccess();

    render((await ConsumptionPage({ searchParams: { view: 'product' } })) as never);

    const table = screen.getByRole('table');
    expect(within(table).getByText('03, 05')).toBeTruthy();
    // В разрезе по номенклатуре колонки РЦ нет — там только перечень кодов.
    expect(within(table).queryByText('03 — Тубировка крем')).toBeNull();
  });

  it('фильтры РЦ и номенклатуры уходят в расчёт и остаются в ссылке выгрузки', async () => {
    mockAccess();

    render(
      (await ConsumptionPage({
        searchParams: {
          workCenterId: 'wc-03',
          productId: 'mat-100',
          period: 'day',
          from: '2026-10-12',
          to: '2026-10-18'
        }
      })) as never
    );

    expect(getConsumptionReport).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      workCenterId: 'wc-03',
      productId: 'mat-100'
    });

    const href = screen.getByRole('link', { name: 'Выгрузить в Excel' }).getAttribute('href') ?? '';
    expect(href).toContain('workCenterId=wc-03');
    expect(href).toContain('productId=mat-100');
    expect(href).toContain('period=day');
  });

  it('итоги по категориям и по строкам', async () => {
    mockAccess();

    render((await ConsumptionPage({ searchParams: {} })) as never);

    expect(screen.getByText(/Масса 120 · ПФ 0 · ГП 0/)).toBeTruthy();
    expect(screen.getByText('строк: 2')).toBeTruthy();
  });

  it('счётчик «не в основном факте» показывается подписью, когда он не ноль', async () => {
    mockAccess();
    (getConsumptionReport as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...REPORT,
      totals: { ...REPORT.totals, linesWithSecondaryConsumption: 2 }
    });

    render((await ConsumptionPage({ searchParams: {} })) as never);

    expect(screen.getByRole('note').textContent).toContain(SECONDARY_CONSUMPTION_NOTE);
    expect(screen.getByText(/Строк: 2/)).toBeTruthy();
  });

  it('при нулевом счётчике подписи нет', async () => {
    mockAccess();

    render((await ConsumptionPage({ searchParams: {} })) as never);

    expect(screen.queryByRole('note')).toBeNull();
  });

  it('пустой период — понятный текст', async () => {
    mockAccess();
    (getConsumptionReport as ReturnType<typeof vi.fn>).mockResolvedValue({
      workCenters: [],
      products: [],
      totals: { byCategory: { MASS: 0, PF: 0, GP: 0 }, lines: 0, linesWithSecondaryConsumption: 0 }
    });

    render((await ConsumptionPage({ searchParams: {} })) as never);

    expect(screen.getByText('За выбранный период потребления нет.')).toBeTruthy();
  });
});
