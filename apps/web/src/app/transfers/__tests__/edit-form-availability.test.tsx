import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { GoodsTransfer, Product, TransferLine, Warehouse } from '@prisma/client';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('../actions', () => ({ updateGoodsTransferAction: vi.fn() }));

import TransferEditForm from '../[id]/edit/_client-form';

const production: Warehouse = {
  id: 'wh-prod',
  name: 'Производственный',
  description: null,
  type: 'PRODUCTION',
  active: true,
};

const finishedGoods: Warehouse = {
  id: 'wh-fg',
  name: 'Склад ГП',
  description: null,
  type: 'FINISHED_GOODS',
  active: true,
};

const product: Product = {
  id: 'p-1',
  code: 'GP001',
  name: 'Готовая продукция А',
  category: 'GP',
  unit: 'шт',
  active: true,
};

const transfer = {
  id: 't-1',
  status: 'SUBMITTED',
  sourceWarehouseId: production.id,
  destinationWarehouseId: finishedGoods.id,
  submittedAt: new Date(),
  submittedByUserId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  lines: [
    {
      id: 'l-1',
      goodsTransferId: 't-1',
      productId: product.id,
      product,
      plannedQuantity: 10,
      actualQuantity: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ],
} as unknown as GoodsTransfer & { lines: Array<TransferLine & { product: Product }> };

function renderForm() {
  return render(
    <TransferEditForm
      transfer={transfer}
      warehouses={[production, finishedGoods]}
      products={[product]}
      stockByWarehouse={{
        [production.id]: { [product.id]: 5 },
        [finishedGoods.id]: { [product.id]: 3 },
      }}
    />,
  );
}

describe('Правка отправленного Перемещения: доступный остаток (T-066)', () => {
  it('учитывает резерв, пока склад-источник не менялся', () => {
    renderForm();

    // Остаток склада-источника 5 + уже списанные этим Перемещением 10 = 15.
    expect(screen.getByText('Доступно на складе-источнике: 15.00 шт')).toBeTruthy();
  });

  it('не прибавляет чужой резерв при смене склада-источника', () => {
    renderForm();

    fireEvent.change(screen.getByLabelText('Склад-источник'), {
      target: { value: finishedGoods.id },
    });

    // С нового склада ничего не списывалось: доступен только его остаток, 3.
    // Прежнее количество 10 его превышает, поэтому форма показывает предупреждение.
    // До исправления к остатку нового склада прибавлялся чужой резерв (3 + 10 = 13),
    // превышения не было — и сервер отклонял сохранение уже после отправки формы.
    expect(screen.getByText('Недостаточно остатка: доступно 3.00 шт')).toBeTruthy();
  });
});
