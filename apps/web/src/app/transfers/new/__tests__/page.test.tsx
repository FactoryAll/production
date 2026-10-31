import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/lib/auth/page-guard', () => ({ checkPageAccess: vi.fn() }));
vi.mock('../../queries', () => ({
  getTransferCreateData: vi.fn(),
}));
vi.mock('@prodtrack/db', () => ({
  prisma: {
    productionOrderLine: { findMany: vi.fn() },
  },
}));

import { checkPageAccess } from '@/lib/auth/page-guard';
import { getTransferCreateData } from '../../queries';
import { prisma } from '@prodtrack/db';
import NewTransferPage from '../page';

/**
 * Поле «Строка ПЗ» в форме перемещения (ОПЭ-74, решение владельца — вариант A).
 *
 * Привязка нужна доске контура, но раньше поле видели только обладатели
 * `production_order:read` — и складские роли (КСГП, УСГП) не могли связать перемещение
 * со строкой, поэтому их перемещения не попадали в колонки 6–9.
 */
function mockAccess(roles: string[]) {
  (checkPageAccess as ReturnType<typeof vi.fn>).mockResolvedValue({
    allowed: true,
    roles,
    session: { userId: 'user-1', user: { id: 'user-1', roles: roles.map((code) => ({ role: { code } })) } },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (getTransferCreateData as ReturnType<typeof vi.fn>).mockResolvedValue({
    warehouses: [
      { id: 'wh-prod', name: 'Производственный склад', type: 'PRODUCTION', active: true },
      { id: 'wh-gp', name: 'Склад ГП', type: 'FINISHED_GOODS', active: true },
    ],
    products: [
      { id: 'gp-1', code: 'GP002', name: 'Готовая продукция Б', unit: 'шт', category: 'GP', active: true },
    ],
    stockByWarehouse: {},
  });
  (prisma.productionOrderLine.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
    {
      id: 'line-1',
      productId: 'gp-1',
      product: { code: 'GP002', name: 'Готовая продукция Б' },
      workCenter: { code: '03' },
      order: { id: 'po-12345678', shift: { number: 2, date: new Date('2026-10-30T00:00:00') } },
    },
  ]);
});

describe('Поле «Строка ПЗ» для складских ролей (ОПЭ-74)', () => {
  it('КСГП видит поле, хотя production_order:read у него нет', async () => {
    mockAccess(['KSGP']);

    render((await NewTransferPage({ searchParams: {} })) as never);

    expect(screen.getByLabelText('Строка ПЗ (необязательно)')).toBeTruthy();
  });

  it('УСГП видит поле', async () => {
    mockAccess(['USGP']);

    render((await NewTransferPage({ searchParams: {} })) as never);

    expect(screen.getByLabelText('Строка ПЗ (необязательно)')).toBeTruthy();
  });

  it('НП видит поле', async () => {
    mockAccess(['NP']);

    render((await NewTransferPage({ searchParams: {} })) as never);

    expect(screen.getByLabelText('Строка ПЗ (необязательно)')).toBeTruthy();
  });

  it('в списке — минимум данных: ПЗ, смена, РЦ', async () => {
    mockAccess(['KSGP']);

    // Продукт приходит из карточки ПЗ (путь «создать перемещение из строки ПЗ»):
    // список строк ПЗ строится по нему.
    render((await NewTransferPage({ searchParams: { productId: 'gp-1' } })) as never);

    const select = screen.getByLabelText('Строка ПЗ (необязательно)') as HTMLSelectElement;
    expect(select.textContent).toContain('ПЗ po-12345');
    expect(select.textContent).toContain('смена 2 от 30.10.2026');
    expect(select.textContent).toContain('РЦ 03');
    // Номенклатура в подписи не дублируется: она уже выбрана в строке перемещения.
    expect(select.textContent).not.toContain('GP002');
  });

  it('строки ПЗ запрашиваются по выбранной номенклатуре и без отменённых ПЗ', async () => {
    mockAccess(['KSGP']);

    await NewTransferPage({ searchParams: { productId: 'gp-1' } });

    expect(prisma.productionOrderLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          product: { id: 'gp-1', category: 'GP' },
          order: { status: { not: 'CANCELLED' } },
        },
      }),
    );
  });

});
