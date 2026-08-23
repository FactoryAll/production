export const dynamic = 'force-dynamic';

import { prisma } from '@prodtrack/db';
import WarehousesPage from './_client-page';

export default async function WarehousesServerPage() {
  const warehouses = await prisma.warehouse.findMany({ orderBy: { name: 'asc' } });
  return <WarehousesPage warehouses={warehouses} />;
}
