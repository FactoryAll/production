import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Prisma } from '@prisma/client';

const Decimal = Prisma.Decimal;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const correctProductionFactAction = vi.fn();

vi.mock('../actions', () => ({
  confirmProductionOrderAction: vi.fn(),
  substituteOperatorAction: vi.fn(),
  cancelProductionOrderAction: vi.fn(),
  correctProductionFactAction: (...args: unknown[]) => correctProductionFactAction(...args),
}));

import ProductionOrderCard from '../[id]/_client-card';

const massProduct = {
  id: 'mass-1',
  code: 'MASS001',
  name: 'Масса базовая',
  unit: 'кг',
  category: 'MASS',
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const fact = {
  id: 'fact-1',
  lineId: 'line-1',
  productId: 'gp-1',
  factCategory: 'GP',
  quantity: new Decimal(45),
  defectQuantity: new Decimal(0),
  defectReasonId: null,
  defectReason: null,
  stopsCount: 0,
  stopsDurationMinutes: 0,
  comment: null,
  recordedAt: new Date(),
  reportedAt: new Date(),
  reportedByUserId: 'user-1',
  createdById: 'user-1',
  postCompletionCorrection: false,
  correctionReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  consumptions: [
    { id: 'c-1', productionFactId: 'fact-1', productId: 'mass-1', quantity: new Decimal(30), createdAt: new Date() },
  ],
};

function makeOrder() {
  return {
    id: 'po-1',
    status: 'COMPLETED',
    shiftId: 'shift-1',
    createdById: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: new Date(),
    confirmedAt: null,
    confirmedByUserId: null,
    cancelledAt: null,
    cancelledByUserId: null,
    cancellationReason: null,
    shift: { id: 'shift-1', number: 1, date: new Date(), start: '08:00', end: '20:00', active: true },
    createdBy: { id: 'user-1', login: 'np' },
    confirmedBy: null,
    cancelledBy: null,
    lines: [
      {
        id: 'line-1',
        orderId: 'po-1',
        workCenterId: 'wc-03',
        productId: 'gp-1',
        plannedQuantity: new Decimal(40),
        operatorId: 'emp-1',
        status: 'REPORTED',
        comment: null,
        substitutionReasonId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        workCenter: { id: 'wc-03', code: '03', name: '03.Тубировка крем', producesMass: false, active: true },
        product: {
          id: 'gp-1',
          code: 'GP002',
          name: 'Готовая продукция Б',
          unit: 'шт',
          category: 'GP',
          active: true,
        },
        operator: null,
        facts: [fact],
        workerAssignments: [],
      },
    ],
  } as never;
}

describe('Корректировка факта: потребление (T-073, Р-10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('показывает текущий состав потребления и позволяет добавить строку', async () => {
    render(
      <ProductionOrderCard
        order={makeOrder()}
        defectReasons={[]}
        consumableProducts={[massProduct] as never}
        userRoles={['NP']}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Корректировать факт' }));

    const quantityInputs = await screen.findAllByLabelText('Количество потребления');
    expect(quantityInputs).toHaveLength(1);
    expect((quantityInputs[0] as HTMLInputElement).value).toBe('30');

    fireEvent.click(screen.getByRole('button', { name: 'Добавить строку потребления' }));
    expect(screen.getAllByLabelText('Количество потребления')).toHaveLength(2);
  });

  it('отправляет потребление вместе с корректировкой факта', async () => {
    correctProductionFactAction.mockResolvedValue({ success: true });

    render(
      <ProductionOrderCard
        order={makeOrder()}
        defectReasons={[]}
        consumableProducts={[massProduct] as never}
        userRoles={['NP']}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Корректировать факт' }));
    await screen.findAllByLabelText('Количество потребления');

    fireEvent.change(screen.getByLabelText('Количество потребления'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('Причина корректировки'), {
      target: { value: 'Уточнение потребления' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить корректировку' }));

    await waitFor(() => {
      expect(correctProductionFactAction).toHaveBeenCalled();
    });

    const formData = correctProductionFactAction.mock.calls[0][1] as FormData;
    expect(formData.get('consumption')).toBe(JSON.stringify([{ productId: 'mass-1', quantity: 20 }]));
  });

  it('удаление всех строк потребления отправляет пустой список (T-073)', async () => {
    correctProductionFactAction.mockResolvedValue({ success: true });

    render(
      <ProductionOrderCard
        order={makeOrder()}
        defectReasons={[]}
        consumableProducts={[massProduct] as never}
        userRoles={['NP']}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Корректировать факт' }));
    await screen.findAllByLabelText('Количество потребления');

    fireEvent.click(screen.getByRole('button', { name: 'Удалить строку потребления' }));
    fireEvent.change(screen.getByLabelText('Причина корректировки'), {
      target: { value: 'Потребления не было' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить корректировку' }));

    await waitFor(() => {
      expect(correctProductionFactAction).toHaveBeenCalled();
    });

    const formData = correctProductionFactAction.mock.calls[0][1] as FormData;
    expect(formData.get('consumption')).toBe('[]');
  });
});
