import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Prisma } from '@prisma/client';

const Decimal = Prisma.Decimal;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock('../actions', () => ({
  createGoodsTransferAction: vi.fn(),
}));

import TransferForm from '../_client-form';

/**
 * Форма создания перемещения: предзаполнение из карточки ПЗ и поле «Строка ПЗ» (T-103).
 *
 * Поле привязки видят только те, кому можно читать ПЗ: у КСГП и УСГП такого права нет,
 * и список строк ПЗ раскрыл бы данные, к которым права не выданы.
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

const STOCK = new Map([['wh-prod|gp-1', new Decimal(100)]]);

function renderForm(overrides: Record<string, unknown> = {}) {
  return render(
    <TransferForm
      warehouses={[PRODUCTION, FINISHED_GOODS] as never}
      products={[PRODUCT] as never}
      stockByWarehouse={STOCK as never}
      canLinkOrderLine
      orderLines={[
        { id: 'line-1', productId: 'gp-1', label: 'ПЗ po-1 · РЦ 03 · GP002 · смена 2' },
        { id: 'line-2', productId: 'other-1', label: 'ПЗ po-2 · РЦ 04 · GP003 · смена 1' },
      ]}
      {...overrides}
    />,
  );
}

describe('Создание перемещения из строки ПЗ (T-103)', () => {
  it('открывается с предзаполненными складами, номенклатурой и количеством', () => {
    renderForm({
      initialSourceWarehouseId: PRODUCTION.id,
      initialDestinationWarehouseId: FINISHED_GOODS.id,
      initialLines: [{ productId: 'gp-1', plannedQuantity: '45', productionOrderLineId: 'line-1' }],
    });

    const source = screen.getByLabelText('Склад-источник') as HTMLSelectElement;
    expect(source.value).toBe(PRODUCTION.id);

    const quantityInputs = screen.getAllByRole('spinbutton');
    expect((quantityInputs[0] as HTMLInputElement).value).toBe('45');
  });

  it('поле «Строка ПЗ» видно обладателю production_order:read, и в списке — строки той же номенклатуры', () => {
    renderForm({
      initialLines: [{ productId: 'gp-1', plannedQuantity: '45', productionOrderLineId: 'line-1' }],
    });

    const orderLineSelect = screen.getByLabelText('Строка ПЗ (необязательно)') as HTMLSelectElement;
    expect(orderLineSelect.value).toBe('line-1');
    // Чужая номенклатура в списке не предлагается: сервер её всё равно отклонит.
    expect(orderLineSelect.textContent).toContain('GP002');
    expect(orderLineSelect.textContent).not.toContain('GP003');
  });

  it('без права на чтение ПЗ поля привязки нет', () => {
    renderForm({ canLinkOrderLine: false });

    expect(screen.queryByLabelText('Строка ПЗ (необязательно)')).toBeNull();
  });

  it('в ручном режиме поле привязки пустое — «без привязки»', () => {
    renderForm();

    const orderLineSelect = screen.getByLabelText('Строка ПЗ (необязательно)') as HTMLSelectElement;
    expect(orderLineSelect.value).toBe('');
    expect(orderLineSelect.textContent).toContain('Без привязки');
  });
});
