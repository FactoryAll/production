export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import { getProductionOrderById } from '../actions';
import ProductionOrderCard from './_client-card';
import { ObjectHistory } from '@/components/object-history';
import { requireSession } from '@/lib/auth/session';

interface ProductionOrderPageProps {
  params: { id: string };
}

export default async function ProductionOrderPage({ params }: ProductionOrderPageProps) {
  const [{ order, defectReasons }, session] = await Promise.all([
    getProductionOrderById(params.id),
    requireSession(),
  ]);
  if (!order) {
    notFound();
  }
  const userRoles = session.user.roles.map((ur) => ur.role.code);
  return (
    <>
      <ProductionOrderCard order={order} defectReasons={defectReasons} userRoles={userRoles} />
      {/* Вкладка «История» карточки объекта (M13 §8). */}
      <ObjectHistory
        objectType="ProductionOrder"
        objectId={order.id}
        canShowArchived={userRoles.includes('ADM')}
      />
    </>
  );
}
