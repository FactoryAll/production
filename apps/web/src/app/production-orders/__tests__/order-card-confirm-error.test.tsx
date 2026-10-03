import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ProductionOrder, Shift, User, DefectReason } from '@prisma/client';

const confirmProductionOrderAction = vi.fn();
const substituteOperatorAction = vi.fn();
const cancelProductionOrderAction = vi.fn();
const correctProductionFactAction = vi.fn();
const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

vi.mock('../actions', () => ({
  confirmProductionOrderAction: (...args: unknown[]) => confirmProductionOrderAction(...args),
  substituteOperatorAction: (...args: unknown[]) => substituteOperatorAction(...args),
  cancelProductionOrderAction: (...args: unknown[]) => cancelProductionOrderAction(...args),
  correctProductionFactAction: (...args: unknown[]) => correctProductionFactAction(...args),
}));

import ProductionOrderCard from '../[id]/_client-card';

const shift = {
  id: 'shift-1',
  number: 1,
  date: new Date('2026-10-03T00:00:00Z'),
  start: '08:00',
  end: '20:00',
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
} as Shift;

const createdBy = { id: 'user-1', login: 'np' } as Pick<User, 'id' | 'login'>;

function makeOrder(status: ProductionOrder['status']) {
  return {
    id: 'order-1',
    status,
    shiftId: shift.id,
    createdByUserId: 'user-1',
    confirmedByUserId: null,
    cancelledByUserId: null,
    cancelReason: null,
    createdAt: new Date('2026-10-03T09:00:00Z'),
    updatedAt: new Date('2026-10-03T09:00:00Z'),
    shift,
    createdBy,
    confirmedBy: null,
    cancelledBy: null,
    lines: [],
  } as unknown as Parameters<typeof ProductionOrderCard>[0]['order'];
}

describe('ProductionOrderCard: ошибка подтверждения ПЗ видна пользователю (T-065)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('показывает ошибку и не закрывает диалог', async () => {
    // Регрессия: обработчик закрывал диалог и не сохранял ошибку,
    // поэтому при отказе сервера пользователь не видел причину.
    confirmProductionOrderAction.mockResolvedValue({
      success: false,
      error: 'Нельзя подтвердить ПЗ: строка РЦ 03.Фасовка не содержит Оператора',
    });

    render(
      <ProductionOrderCard order={makeOrder('DRAFT')} defectReasons={[] as DefectReason[]} userRoles={['NP']} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить ПЗ' }));

    const dialogButtons = await screen.findAllByRole('button', { name: 'Подтвердить' });
    fireEvent.click(dialogButtons[dialogButtons.length - 1]);

    await waitFor(() => {
      expect(screen.getByText(/Нельзя подтвердить ПЗ/)).toBeTruthy();
    });

    // Диалог остаётся открытым — сообщение не теряется.
    expect(screen.getByText('Подтвердить ПЗ?')).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });
});
