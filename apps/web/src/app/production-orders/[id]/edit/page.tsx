export const dynamic = 'force-dynamic';

import { AccessDenied } from '@/components/access-denied';
import { checkPageAccess } from '@/lib/auth/page-guard';

import { notFound } from 'next/navigation';
import { getProductionOrderById, getProductionOrderCreateData } from '../../actions';
import ProductionOrderEditForm from './_client-form';
import type { ProductionOrderStatus } from '@prisma/client';

interface ProductionOrderEditPageProps {
  params: { id: string };
}

export default async function ProductionOrderEditPage({ params }: ProductionOrderEditPageProps) {
  const access = await checkPageAccess('production_order:update');
  if (!access.allowed) {
    return <AccessDenied action="корректировка производственного задания" allowedRoles={['NP', 'ADM']} requiredPermission='production_order:update' />;
  }
  const [{ order }, createData] = await Promise.all([
    getProductionOrderById(params.id),
    getProductionOrderCreateData(),
  ]);
  if (!order) {
    notFound();
  }

  const editableStatuses: ProductionOrderStatus[] = ['DRAFT', 'CONFIRMED', 'IN_PROGRESS'];
  const canEdit =
    editableStatuses.includes(order.status) &&
    !order.lines.some((line) => line.status === 'REPORTED');
  if (!canEdit) {
    notFound();
  }

  return (
    <ProductionOrderEditForm
      order={order}
      shiftOptions={createData.shiftOptions}
      workCenters={createData.workCenters}
      products={createData.products}
      workerEmployees={createData.workerEmployees}
      operatorEmployees={createData.operatorEmployees}
    />
  );
}
