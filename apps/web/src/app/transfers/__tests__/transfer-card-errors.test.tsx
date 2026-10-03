import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { GoodsTransfer, TransferLine, Warehouse, Product, User } from '@prisma/client';

const submitGoodsTransferAction = vi.fn();
const cancelGoodsTransferAction = vi.fn();
const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

vi.mock('../actions', () => ({
  submitGoodsTransferAction: (...args: unknown[]) => submitGoodsTransferAction(...args),
  cancelGoodsTransferAction: (...args: unknown[]) => cancelGoodsTransferAction(...args),
}));

import TransferCard from '../[id]/_client-card';

const sourceWarehouse = { id: 'wh-prod', name: 'Производственный' } as Warehouse;
const destinationWarehouse = { id: 'wh-gp', name: 'Склад ГП' } as Warehouse;
const product = { id: 'p-1', code: 'GP001', name: 'Готовая продукция А', unit: 'шт' } as Product;

function makeTransfer(status: GoodsTransfer['status']): GoodsTransfer & {
  sourceWarehouse: Warehouse;
  destinationWarehouse: Warehouse;
  submittedBy: Pick<User, 'id' | 'login'> | null;
  lines: Array<TransferLine & { product: Product; discrepancies: never[] }>;
} {
  return {
    id: 'transfer-1',
    status,
    sourceWarehouseId: 'wh-prod',
    destinationWarehouseId: 'wh-gp',
    submittedByUserId: null,
    submittedAt: null,
    createdAt: new Date('2026-10-03T10:00:00Z'),
    updatedAt: new Date('2026-10-03T10:00:00Z'),
    sourceWarehouse,
    destinationWarehouse,
    submittedBy: null,
    lines: [
      {
        id: 'line-1',
        goodsTransferId: 'transfer-1',
        productId: 'p-1',
        plannedQuantity: '1000' as unknown as TransferLine['plannedQuantity'],
        actualQuantity: null as unknown as TransferLine['actualQuantity'],
        createdAt: new Date('2026-10-03T10:00:00Z'),
        updatedAt: new Date('2026-10-03T10:00:00Z'),
        product,
        discrepancies: [],
      } as unknown as TransferLine & { product: Product; discrepancies: never[] },
    ],
  };
}

describe('TransferCard: ошибки серверных действий видны пользователю', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('показывает ошибку отправки и не закрывает диалог', async () => {
    // Регрессия: диалог закрывался до установки ошибки, из-за чего при превышении
    // остатка пользователь не видел сообщения («ничего не происходит»).
    submitGoodsTransferAction.mockResolvedValue({
      success: false,
      error: 'Недостаточно остатка для продукта Готовая продукция А: требуется 1000.00, доступно 75.00',
    });

    render(<TransferCard transfer={makeTransfer('DRAFT')} userRoles={['NP']} />);

    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));

    const dialogButtons = await screen.findAllByRole('button', { name: 'Отправить' });
    fireEvent.click(dialogButtons[dialogButtons.length - 1]);

    await waitFor(() => {
      expect(screen.getByText(/Недостаточно остатка для продукта/)).toBeTruthy();
    });

    // Диалог остаётся открытым — сообщение видно пользователю.
    expect(screen.getByText('Отправить перемещение?')).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('показывает ошибку отмены и не закрывает диалог', async () => {
    cancelGoodsTransferAction.mockResolvedValue({
      success: false,
      error: 'Перемещение нельзя отменить в этом статусе',
    });

    render(<TransferCard transfer={makeTransfer('DRAFT')} userRoles={['NP']} />);

    fireEvent.click(screen.getByRole('button', { name: 'Отменить перемещение' }));

    const dialogButtons = await screen.findAllByRole('button', { name: 'Отменить' });
    fireEvent.click(dialogButtons[dialogButtons.length - 1]);

    await waitFor(() => {
      expect(screen.getByText('Перемещение нельзя отменить в этом статусе')).toBeTruthy();
    });

    expect(screen.getByText('Отменить перемещение?')).toBeTruthy();
  });
});
