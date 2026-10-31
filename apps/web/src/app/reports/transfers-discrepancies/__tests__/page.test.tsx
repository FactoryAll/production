import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/auth/page-guard', () => ({ checkPageAccess: vi.fn() }));
vi.mock('@/lib/reports/transfers-discrepancies-report', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/reports/transfers-discrepancies-report')
  >('@/lib/reports/transfers-discrepancies-report');
  return { ...actual, getTransfersDiscrepanciesReport: vi.fn() };
});
vi.mock('@prodtrack/db', () => ({
  prisma: {
    shift: { findMany: vi.fn() },
    productionOrder: { findFirst: vi.fn().mockResolvedValue(null) },
    product: { findMany: vi.fn() }
  }
}));

import { checkPageAccess } from '@/lib/auth/page-guard';
import { prisma } from '@prodtrack/db';
import {
  MISSING_TIMING_NOTE,
  getTransfersDiscrepanciesReport
} from '@/lib/reports/transfers-discrepancies-report';
import { AccessDenied } from '@/components/access-denied';
import TransfersDiscrepanciesPage from '../page';

/**
 * Экран «Перемещения и расхождения» (T-099).
 *
 * Владелец решил: срок согласования — от приёмки с расхождением до согласования по журналу
 * переходов; без норматива (слова «просрочено» нет); период разреза по расхождениям — по дате
 * приёмки; пропуск журнала — «—» и счётчик; выгрузка одним файлом с колонкой «Разрез».
 */
function mockAccess(allowed = true) {
  (checkPageAccess as ReturnType<typeof vi.fn>).mockResolvedValue({
    allowed,
    roles: ['OTK'],
    session: { userId: 'user-1', user: { id: 'user-1', roles: [{ role: { code: 'OTK' } }] } }
  });
}

const REPORT = {
  transfers: [
    {
      transferId: 'tr-1',
      status: 'RECEIVED',
      submittedAt: new Date('2026-10-10T09:00:00'),
      receivedAt: new Date('2026-10-10T13:00:00'),
      sourceWarehouseName: 'Производственный склад',
      destinationWarehouseName: 'Склад ГП',
      productCode: 'GP002',
      productName: 'Готовая продукция Б',
      productUnit: 'шт',
      plannedQuantity: 40,
      actualQuantity: 37,
      cycleHours: 4,
      hasDiscrepancy: true
    }
  ],
  discrepancies: [
    {
      transferId: 'tr-1',
      productCode: 'GP002',
      productName: 'Готовая продукция Б',
      productUnit: 'шт',
      plannedQuantity: 40,
      actualQuantity: 37,
      difference: -3,
      discrepancyAt: new Date('2026-10-11T09:00:00'),
      reconciled: true,
      reconciledAt: new Date('2026-10-12T09:00:00'),
      resolutionHours: 24,
      cancelled: false
    }
  ],
  totals: {
    transfers: 1,
    withDiscrepancy: 1,
    notReconciled: 0,
    maxResolutionHours: 24,
    averageResolutionHours: 24,
    rowsWithoutTiming: 0,
    transfersWithoutReceipt: 0
  }
};

describe('Экран «Перемещения и расхождения»', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.shift.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.product.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'gp-2', code: 'GP002', name: 'Готовая продукция Б' }
    ]);
    (getTransfersDiscrepanciesReport as ReturnType<typeof vi.fn>).mockResolvedValue(REPORT);
  });

  it('без права reports:read — экран «Доступ запрещён»', async () => {
    mockAccess(false);

    const element = await TransfersDiscrepanciesPage({ searchParams: {} });

    expect(element.type).toBe(AccessDenied);
    expect(getTransfersDiscrepanciesReport).not.toHaveBeenCalled();
  });

  it('по умолчанию — по перемещениям: цикл и фактическое количество', async () => {
    mockAccess();

    render((await TransfersDiscrepanciesPage({ searchParams: {} })) as never);

    const table = screen.getByRole('table');
    expect(within(table).getByText('tr-1')).toBeTruthy();
    expect(within(table).getByText('37 шт')).toBeTruthy();
    expect(within(table).getByText('40 шт')).toBeTruthy();
    expect(within(table).getByText('4 ч')).toBeTruthy();
    expect(within(table).getByText('Принято складом')).toBeTruthy();
  });

  it('по расхождениям: срок согласования и разница', async () => {
    mockAccess();

    render((await TransfersDiscrepanciesPage({ searchParams: { view: 'discrepancy' } })) as never);

    const table = screen.getByRole('table');
    expect(within(table).getByText('24 ч')).toBeTruthy();
    expect(within(table).getByText('-3')).toBeTruthy();
    expect(within(table).getByText('не согласовано: 0')).toBeTruthy();
    expect(within(table).getByText('макс: 24 ч')).toBeTruthy();
  });

  it('слово «просрочено» не используется: норматива нет', async () => {
    mockAccess();

    render((await TransfersDiscrepanciesPage({ searchParams: { view: 'discrepancy' } })) as never);

    expect(screen.queryByText(/просроч/i)).toBeNull();
  });

  it('пропуск журнала: «—» и счётчик в подписи', async () => {
    mockAccess();
    (getTransfersDiscrepanciesReport as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...REPORT,
      discrepancies: [
        {
          ...REPORT.discrepancies[0],
          discrepancyAt: null,
          resolutionHours: null
        }
      ],
      totals: {
        ...REPORT.totals,
        rowsWithoutTiming: 1,
        maxResolutionHours: null,
        averageResolutionHours: null
      }
    });

    render((await TransfersDiscrepanciesPage({ searchParams: { view: 'discrepancy' } })) as never);

    const table = screen.getByRole('table');
    expect(within(table).getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('note').textContent).toContain(MISSING_TIMING_NOTE);
    expect(screen.getByText(/Строк без записи журнала: 1/)).toBeTruthy();
  });

  it('фильтр по номенклатуре уходит в расчёт и остаётся в ссылке выгрузки', async () => {
    mockAccess();

    render(
      (await TransfersDiscrepanciesPage({
        searchParams: { productId: 'gp-2', period: 'day', from: '2026-10-12', to: '2026-10-18' }
      })) as never
    );

    expect(getTransfersDiscrepanciesReport).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.any(Date),
      { productId: 'gp-2' }
    );

    const href = screen.getByRole('link', { name: 'Выгрузить в Excel' }).getAttribute('href') ?? '';
    expect(href).toContain('productId=gp-2');
    expect(href).toContain('period=day');
  });

  it('пустой период — понятные тексты в каждом разрезе', async () => {
    mockAccess();
    (getTransfersDiscrepanciesReport as ReturnType<typeof vi.fn>).mockResolvedValue({
      transfers: [],
      discrepancies: [],
      totals: {
        transfers: 0,
        withDiscrepancy: 0,
        notReconciled: 0,
        maxResolutionHours: null,
        averageResolutionHours: null,
        rowsWithoutTiming: 0,
        transfersWithoutReceipt: 0
      }
    });

    render((await TransfersDiscrepanciesPage({ searchParams: {} })) as never);
    expect(screen.getByText('За выбранный период перемещений нет.')).toBeTruthy();

    document.body.innerHTML = '';
    render((await TransfersDiscrepanciesPage({ searchParams: { view: 'discrepancy' } })) as never);
    expect(screen.getByText('За выбранный период расхождений нет.')).toBeTruthy();
  });
});
