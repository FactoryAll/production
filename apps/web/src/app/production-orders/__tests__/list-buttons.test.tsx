import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock('../actions', () => ({
  confirmProductionOrderAction: vi.fn(),
  cancelProductionOrderAction: vi.fn(),
}));

import ProductionOrdersPage from '../_client-page';

const order = {
  id: 'po-1',
  status: 'CONFIRMED' as const,
  shiftId: 'shift-1',
  createdById: 'user-1',
  createdAt: new Date('2026-10-04T14:24:40Z'),
  updatedAt: new Date('2026-10-04T14:24:40Z'),
  completedAt: null,
  confirmedAt: new Date('2026-10-04T14:25:13Z'),
  confirmedByUserId: 'user-1',
  cancelledAt: null,
  cancelledByUserId: null,
  cancellationReason: null,
  shift: {
    id: 'shift-1',
    number: 1,
    date: new Date('2026-10-04'),
    start: '08:00',
    end: '20:00',
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  lines: [
    {
      id: 'line-1',
      orderId: 'po-1',
      workCenterId: 'wc-01',
      productId: 'p-1',
      plannedQuantity: { toString: () => '10' },
      operatorId: 'emp-1',
      status: 'ASSIGNED' as const,
      comment: null,
      substitutionReasonId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      workCenter: { id: 'wc-01', code: '01', name: '01.Реактор' },
    },
  ],
};

describe('Список ПЗ: кнопки по правам роли (дефект №3 ручного тестирования)', () => {
  it('под С1С нет кнопки создания ПЗ — роль имеет только просмотр', () => {
    render(
      <ProductionOrdersPage orders={[order] as never} userRoles={['S1C']} statusFilter="ALL" />,
    );

    expect(screen.queryByRole('button', { name: 'Создать ПЗ' })).toBeNull();
  });

  it('под НП кнопка создания ПЗ есть', () => {
    render(
      <ProductionOrdersPage orders={[order] as never} userRoles={['NP']} statusFilter="ALL" />,
    );

    expect(screen.getByRole('button', { name: 'Создать ПЗ' })).toBeTruthy();
  });
});
