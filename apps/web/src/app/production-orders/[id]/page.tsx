export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import { AccessDenied } from '@/components/access-denied';
import { ObjectHistory } from '@/components/object-history';
import { checkPageAccess } from '@/lib/auth/page-guard';

import { getProductionOrderById } from '../actions';
import ProductionOrderCard from './_client-card';

interface ProductionOrderPageProps {
  params: { id: string };
}

export default async function ProductionOrderPage({ params }: ProductionOrderPageProps) {
  // НП/АДМ/С1С видят любое ПЗ, ОПР — только ПЗ своих РЦ (M02). Роли без права
  // чтения получают понятный экран вместо серверной ошибки (T-067).
  const access = await checkPageAccess(['production_order:read', 'production_order:read_own']);
  if (!access.allowed) {
    return (
      <AccessDenied
        action="просмотр производственного задания"
        allowedRoles={['NP', 'OPR', 'S1C', 'ADM']}
        requiredPermission="production_order:read / production_order:read_own"
      />
    );
  }

  const { order, defectReasons, consumableProducts } = await getProductionOrderById(params.id);
  if (!order) {
    // ПЗ не существует либо (для ОПР) в нём нет строк его РЦ — отдаём 404, а не 500.
    notFound();
  }

  const userRoles = access.roles;
  return (
    <>
      <ProductionOrderCard
        order={order}
        defectReasons={defectReasons}
        consumableProducts={consumableProducts}
        userRoles={userRoles}
      />
      {/* Вкладка «История» карточки объекта (M13 §8). */}
      <ObjectHistory
        objectType="ProductionOrder"
        objectId={order.id}
        canShowArchived={userRoles.includes('ADM')}
      />
    </>
  );
}
