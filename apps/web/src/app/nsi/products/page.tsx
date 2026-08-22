export const dynamic = 'force-dynamic';

import { prisma } from '@prodtrack/db';
import ProductsPage from './_client-page';

export default async function ProductsServerPage() {
  const products = await prisma.product.findMany({ orderBy: { code: 'asc' } });
  return <ProductsPage products={products} />;
}
