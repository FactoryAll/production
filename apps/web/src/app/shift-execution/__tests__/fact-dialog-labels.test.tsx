import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Prisma } from '@prisma/client';

const Decimal = Prisma.Decimal;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock('../actions', () => ({
  acceptProductionOrderLineAction: vi.fn(),
  reportProductionFactAction: vi.fn(),
  correctFactByOperatorAction: vi.fn(),
  getAvailableBalanceAction: vi.fn().mockResolvedValue({ available: 279, unit: 'кг' }),
}));

import ShiftExecutionPage from '../_client-page';

const WORK_CENTER_ID = 'abc13ba9-8924-4a59-bc13-8ce4d8ce457d';

function makeLine(overrides: Record<string, unknown> = {}) {
  return {
    id: 'line-1',
    orderId: 'po-1',
    workCenterId: WORK_CENTER_ID,
    productId: 'gp-2',
    plannedQuantity: new Decimal(40),
    operatorId: 'emp-1',
    status: 'ACCEPTED' as const,
    comment: null,
    substitutionReasonId: null,
    createdAt: new Date('2026-10-05T12:59:47.000Z'),
    updatedAt: new Date('2026-10-05T12:59:47.000Z'),
    order: {
      id: 'po-1',
      status: 'IN_PROGRESS' as const,
      shift: { number: 1, date: new Date('2026-10-05T00:00:00.000Z') },
    },
    workCenter: { id: WORK_CENTER_ID, code: '03', name: '03.Тубировка крем', producesMass: false },
    product: {
      id: 'gp-2',
      code: 'GP002',
      name: 'Готовая продукция Б',
      unit: 'шт',
      category: 'GP' as const,
    },
    facts: [],
    ...overrides,
  };
}

function renderPage(lines: Array<ReturnType<typeof makeLine>>) {
  return render(
    <ShiftExecutionPage
      lines={lines as never}
      defectReasons={[]}
      consumableProducts={[]}
      employeeId="emp-1"
    />,
  );
}

describe('Диалоги исполнения смены: понятные подписи (T-072)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('в подтверждении получения показывает РЦ, а не идентификатор', () => {
    renderPage([makeLine({ status: 'ASSIGNED' })]);

    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить получение' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('03 — 03.Тубировка крем');
    expect(dialog.textContent).not.toContain(WORK_CENTER_ID);
  });

  it('в диалоге внесения итога называет РЦ и продукцию строки', () => {
    renderPage([makeLine()]);

    fireEvent.click(screen.getByRole('button', { name: 'Внести итог' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('ПЗ по РЦ');
    expect(dialog.textContent).toContain('03 — 03.Тубировка крем');
    expect(dialog.textContent).toContain('GP002 — Готовая продукция Б (шт)');
    expect(dialog.textContent).not.toContain(WORK_CENTER_ID);
  });
});
