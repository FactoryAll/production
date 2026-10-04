import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock('../actions', () => ({
  submitGoodsTransferAction: vi.fn(),
  cancelGoodsTransferAction: vi.fn(),
}));

import TransferCard from '../[id]/_client-card';

function buildTransfer(status: 'DISCREPANCY' | 'RECONCILED', actualQuantity: string) {
  return {
    id: 'tr-1',
    status,
    sourceWarehouseId: 'wh-prod',
    destinationWarehouseId: 'wh-gp',
    submittedByUserId: 'user-1',
    submittedAt: new Date('2026-10-04T17:51:52Z'),
    createdAt: new Date('2026-10-04T17:51:38Z'),
    updatedAt: new Date('2026-10-04T18:05:47Z'),
    sourceWarehouse: { id: 'wh-prod', name: 'Производственный', type: 'PRODUCTION' },
    destinationWarehouse: { id: 'wh-gp', name: 'Склад ГП', type: 'FINISHED_GOODS' },
    submittedBy: { id: 'user-1', login: 'np' },
    lines: [
      {
        id: 'line-1',
        goodsTransferId: 'tr-1',
        productId: 'p-1',
        plannedQuantity: { toString: () => '10' },
        actualQuantity: { toString: () => actualQuantity },
        createdAt: new Date(),
        updatedAt: new Date(),
        product: { id: 'p-1', code: 'GP002', name: 'Готовая продукция Б', unit: 'шт' },
        discrepancies: [
          {
            id: 'd-1',
            goodsTransferId: 'tr-1',
            transferLineId: 'line-1',
            productId: 'p-1',
            plannedQuantity: { toString: () => '10' },
            actualQuantity: { toString: () => '6' },
            difference: { toString: () => '-4' },
            reconciled: status === 'RECONCILED',
            reconciledAt: null,
            reconciledByUserId: null,
          },
        ],
      },
    ],
  } as never;
}

describe('Карточка Перемещения: количества при расхождении (дефект №4)', () => {
  it('в статусе «Согласовано» показывает факт при приёмке и согласованное количество', () => {
    render(<TransferCard transfer={buildTransfer('RECONCILED', '8')} userRoles={['NP']} />);

    expect(screen.getByText('Факт при приёмке')).toBeTruthy();
    expect(screen.getByText('Согласованное количество')).toBeTruthy();
    expect(screen.getByText('6')).toBeTruthy(); // факт при приёмке
    expect(screen.getByText('8')).toBeTruthy(); // согласованное количество
  });

  it('в статусе «Расхождение» показывает факт, разницу и что согласование не выполнено', () => {
    render(<TransferCard transfer={buildTransfer('DISCREPANCY', '6')} userRoles={['NP']} />);

    expect(screen.getByText('Согласовано')).toBeTruthy();
    expect(screen.getByText('Нет')).toBeTruthy();
    expect(screen.queryByText('Согласованное количество')).toBeNull();
  });
});
