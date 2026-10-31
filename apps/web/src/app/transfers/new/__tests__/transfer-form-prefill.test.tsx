import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock('../actions', () => ({
  createGoodsTransferAction: vi.fn(),
}));

import TransferForm from '../_client-form';

/**
 * Предзаполнение формы перемещения из карточки ПЗ (T-103).
 *
 * Поле «Строка ПЗ» удалено (решение владельца 31.10.2026): кладовщик выбирает ГП, видит
 * остаток и вводит количество, привязка к строке ПЗ модели не нужна. Кнопка в карточке ПЗ
 * осталась и по-прежнему заполняет номенклатуру, склады и количество-факт.
 */
const PRODUCTION = {
  id: 'wh-prod',
  name: 'Производственный склад',
  type: 'PRODUCTION',
  active: true,
  description: null,
  updatedAt: new Date(),
  createdAt: new Date(),
};

const FINISHED_GOODS = {
  id: 'wh-gp',
  name: 'Склад ГП',
  type: 'FINISHED_GOODS',
  active: true,
  description: null,
  updatedAt: new Date(),
  createdAt: new Date(),
};

const PRODUCT = {
  id: 'gp-1',
  code: 'GP002',
  name: 'Готовая продукция Б',
  unit: 'шт',
  category: 'GP',
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const STOCK = { 'wh-prod': { 'gp-1': 100 } };

function renderForm(overrides: Record<string, unknown> = {}) {
  return render(
    <TransferForm
      warehouses={[PRODUCTION, FINISHED_GOODS] as never}
      products={[PRODUCT] as never}
      stockByWarehouse={STOCK as never}
      {...overrides}
    />,
  );
}

describe('Предзаполнение формы перемещения из карточки ПЗ', () => {
  it('открывается с предзаполненными складами, номенклатурой и количеством', () => {
    renderForm({
      initialSourceWarehouseId: PRODUCTION.id,
      initialDestinationWarehouseId: FINISHED_GOODS.id,
      initialLines: [{ productId: 'gp-1', plannedQuantity: '45' }],
    });

    const source = screen.getByLabelText('Склад-источник') as HTMLSelectElement;
    expect(source.value).toBe(PRODUCTION.id);

    const quantityInputs = screen.getAllByRole('spinbutton');
    expect((quantityInputs[0] as HTMLInputElement).value).toBe('45');

    const destination = screen.getByLabelText('Склад-приёмник') as HTMLSelectElement;
    expect(destination.value).toBe(FINISHED_GOODS.id);
  });

  it('поля привязки к строке ПЗ в форме больше нет', () => {
    renderForm();

    expect(screen.queryByLabelText('Строка ПЗ (необязательно)')).toBeNull();
  });

  it('в ручном режиме форма пустая и готова к заполнению', () => {
    renderForm();

    const source = screen.getByLabelText('Склад-источник') as HTMLSelectElement;
    expect(source.value).toBe('');
  });
});
