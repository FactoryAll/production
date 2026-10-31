export const dynamic = 'force-dynamic';

import { AccessDenied } from '@/components/access-denied';
import { checkPageAccess } from '@/lib/auth/page-guard';

import { getTransferCreateData } from '../queries';
import TransferForm from './_client-form';

/**
 * Создание перемещения (M07).
 *
 * С T-103 сюда можно прийти из карточки ПЗ: тогда номенклатура, склады, количество и строка ПЗ
 * приходят в адресе, и форма открывается уже заполненной. Ручной путь остаётся прежним.
 */
export default async function NewTransferPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const access = await checkPageAccess('transfer:create');
  if (!access.allowed) {
    return <AccessDenied action="создание перемещения" allowedRoles={['NP', 'KSGP', 'USGP', 'ADM']} requiredPermission='transfer:create' />;
  }

  const { warehouses, products, stockByWarehouse } = await getTransferCreateData();

  const param = (name: string): string | undefined => {
    const value = searchParams[name];
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
  };


  const productId = param('productId');
  const quantity = param('quantity');

  // Если пришли из карточки ПЗ, склады подставляем парой по умолчанию: перемещение ГП идёт
  // с Производственного склада на Склад ГП (M07). Оба поля остаются редактируемыми.
  const productionWarehouse = warehouses.find((warehouse) => warehouse.type === 'PRODUCTION');
  const finishedGoodsWarehouse = warehouses.find((warehouse) => warehouse.type === 'FINISHED_GOODS');

  return (
    <TransferForm
      warehouses={warehouses}
      products={products}
      stockByWarehouse={stockByWarehouse}
      initialSourceWarehouseId={
        param('sourceWarehouseId') ?? (productId ? (productionWarehouse?.id ?? '') : '')
      }
      initialDestinationWarehouseId={
        param('destinationWarehouseId') ?? (productId ? (finishedGoodsWarehouse?.id ?? '') : '')
      }
      initialLines={
        productId ? [{ productId, plannedQuantity: quantity ?? '' }] : undefined
      }
    />
  );
}
