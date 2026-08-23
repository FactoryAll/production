export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import { getProductionOrderById, getProductionOrderCreateData } from '../../actions';
import ProductionOrderEditForm from './_client-form';
import { requirePermission } from '@/lib/auth/access';
import type { ProductionOrderStatus } from '@prisma/client';

interface ProductionOrderEditPageProps {
  params: { id: string };
}

export default async function ProductionOrderEditPage({ params }: ProductionOrderEditPageProps) {
  await requirePermission('production_order:update');
  const [order, createData] = await Promise.all([
    getProductionOrderById(params.id),
    getProductionOrderCreateData(),
  ]);
  if (!order) {
    notFound();
  }

  const editableStatuses: ProductionOrderStatus[] = ['DRAFT', 'CONFIRMED', 'IN_PROGRESS'];
  const canEdit = editableStatuses.includes(order.status) && !order.lines.some((line) => line.status === 'REPORTED');
  if (!canEdit) {
    notFound();
  }

  return (
    <ProductionOrderEditForm
      order={order}
      shifts={createData.shifts}
      workCenters={createData.workCenters}
      products={createData.products}
      employees={createData.employees}
    />
  );
}
