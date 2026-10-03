export const dynamic = 'force-dynamic';

import { prisma } from '@prodtrack/db';
import { hasPermission } from '@prodtrack/contracts';
import { requireSession } from '@/lib/auth/session';
import ProductsPage from './_client-page';

export default async function ProductsServerPage() {
  const [products, session] = await Promise.all([
    prisma.product.findMany({ orderBy: { code: 'asc' } }),
    requireSession(),
  ]);
  const canManage = hasPermission(
    session.user.roles.map((ur) => ur.role.code),
    'nsi:manage',
  );
  return <ProductsPage products={products} canManage={canManage} />;
}
