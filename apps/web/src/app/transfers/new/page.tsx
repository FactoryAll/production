export const dynamic = 'force-dynamic';

import { AccessDenied } from '@/components/access-denied';
import { checkPageAccess } from '@/lib/auth/page-guard';
import { hasPermission } from '@prodtrack/contracts';
import { prisma } from '@prodtrack/db';

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

  // Поле «Строка ПЗ» видят ВСЕ, кто может создавать перемещение (ОПЭ-74, решение владельца):
  // раньше его показывали только обладателям production_order:read, и у КСГП с УСГП привязка
  // была недоступна — их перемещения не попадали на доску. Список отдаёт минимум данных
  // (короткий id ПЗ, смена, РЦ) и не ведёт в карточку ПЗ, поэтому права на ПЗ не требуются.
  const canLinkOrderLine = hasPermission(access.roles, 'transfer:create');
  const orderLines = canLinkOrderLine ? await getOrderLineOptions() : [];

  const param = (name: string): string | undefined => {
    const value = searchParams[name];
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
  };

  const productionOrderLineId = param('productionOrderLineId');
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
      canLinkOrderLine={canLinkOrderLine}
      orderLines={orderLines}
      initialSourceWarehouseId={
        param('sourceWarehouseId') ?? (productId ? (productionWarehouse?.id ?? '') : '')
      }
      initialDestinationWarehouseId={
        param('destinationWarehouseId') ?? (productId ? (finishedGoodsWarehouse?.id ?? '') : '')
      }
      initialLines={
        productId
          ? [
              {
                productId,
                plannedQuantity: quantity ?? '',
                productionOrderLineId: productionOrderLineId ?? '',
              },
            ]
          : undefined
      }
    />
  );
}

/**
 * Строки ПЗ для поля «Строка ПЗ»: ГП-строки неотменённых ПЗ, свежие смены сверху.
 *
 * Это подсказка для ручного пути, а не справочник, поэтому список ограничен двумястами
 * строками. Основной путь — кнопка «Создать перемещение» в карточке ПЗ, где строка известна.
 */
async function getOrderLineOptions() {
  const lines = await prisma.productionOrderLine.findMany({
    where: {
      product: { category: 'GP' },
      order: { status: { not: 'CANCELLED' } },
    },
    orderBy: [{ order: { shift: { date: 'desc' } } }, { createdAt: 'asc' }],
    take: 200,
    select: {
      id: true,
      productId: true,
      product: { select: { code: true, name: true } },
      workCenter: { select: { code: true } },
      order: { select: { id: true, shift: { select: { number: true, date: true } } } },
    },
  });

  return lines.map((line) => ({
    id: line.id,
    productId: line.productId,
    // Минимум данных для склада (ОПЭ-74): короткий id ПЗ, смена и РЦ — без номенклатуры
    // (она уже выбрана в строке перемещения) и без ссылок в карточку ПЗ.
    label: `ПЗ ${line.order.id.slice(0, 8)} · смена ${line.order.shift.number} от ${line.order.shift.date.toLocaleDateString('ru-RU')} · РЦ ${line.workCenter.code}`,
  }));
}
