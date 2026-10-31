import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

// Форма остатков по складам — как её отдаёт buildStockByWarehouse: Record<склад, Record<продукт, число>>.
const STOCK = { 'wh-prod': { 'gp-1': 100, 'other-1': 50 } };

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

  it('поле «Строка ПЗ» в списке показывает только строки выбранной номенклатуры (ОПЭ-74)', () => {
    renderForm({
      initialLines: [{ productId: 'gp-1', plannedQuantity: '45', productionOrderLineId: 'line-1' }],
    });

    const orderLineSelect = screen.getByLabelText('Строка ПЗ (необязательно)') as HTMLSelectElement;
    expect(orderLineSelect.value).toBe('line-1');
    expect(orderLineSelect.textContent).toContain('GP002');
    // Чужая номенклатура в списке не предлагается: сервер её всё равно отклонит.
    expect(orderLineSelect.textContent).not.toContain('GP003');
  });

  it('без выбранного продукта строк ПЗ не предлагаем (ОПЭ-74, дефект 2)', () => {
    // Раньше здесь показывались ВСЕ ГП-строки — пользователь выбирал чужую номенклатуру,
    // и сервер отклонял перемещение уже на сохранении.
    renderForm();

    const orderLineSelect = screen.getByLabelText('Строка ПЗ (необязательно)') as HTMLSelectElement;
    expect(orderLineSelect.textContent).toContain('Сначала выберите продукт');
    expect(orderLineSelect.textContent).not.toContain('GP002');
    expect(orderLineSelect.textContent).not.toContain('GP003');
  });

  it('смена продукта сбрасывает привязку к строке ПЗ', () => {
    renderForm({
      initialLines: [{ productId: 'gp-1', plannedQuantity: '45', productionOrderLineId: 'line-1' }],
      // Второй продукт нужен, чтобы выбрать его в SearchSelect.
      products: [PRODUCT, { ...PRODUCT, id: 'other-1', code: 'GP003', name: 'Другая продукция' }] as never,
      initialSourceWarehouseId: PRODUCTION.id,
      initialDestinationWarehouseId: FINISHED_GOODS.id,
    });

    const product = screen.getByLabelText('Продукт') as HTMLInputElement;
    fireEvent.focus(product);
    // Оставляем запрос пустым — список открывается со всеми доступными позициями склада.
    const options = screen.getAllByRole('option');
    const other = options.find((option) => option.textContent?.includes('GP003'));
    expect(other).toBeDefined();
    fireEvent.mouseDown(other!);

    // Привязка сброшена — старая строка относится к другой номенклатуре.
    const orderLineSelect = screen.getByLabelText('Строка ПЗ (необязательно)') as HTMLSelectElement;
    expect(orderLineSelect.value).toBe('');
  });

  it('без права на чтение ПЗ поля привязки нет', () => {
    renderForm({ canLinkOrderLine: false });

    expect(screen.queryByLabelText('Строка ПЗ (необязательно)')).toBeNull();
  });

  it('в ручном режиме поле привязки пустое — «без привязки»', () => {
    renderForm({
      products: [
        PRODUCT,
        { ...PRODUCT, id: 'other-1', code: 'GP003', name: 'Другая продукция' },
      ] as never,
      initialSourceWarehouseId: PRODUCTION.id,
      initialLines: [{ productId: 'gp-1', plannedQuantity: '10', productionOrderLineId: '' }],
    });

    const orderLineSelect = screen.getByLabelText('Строка ПЗ (необязательно)') as HTMLSelectElement;
    expect(orderLineSelect.value).toBe('');
    expect(orderLineSelect.textContent).toContain('Без привязки');
  });
});
