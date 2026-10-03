export const dynamic = 'force-dynamic';

import { hasPermission } from '@prodtrack/contracts';
import { requireSession } from '@/lib/auth/session';
import { Pagination } from '@/components/pagination';

import ProductsPage from './_client-page';
import { getProductsPage, parseActiveFilter } from './queries';

interface ProductsServerPageProps {
  searchParams: {
    q?: string;
    active?: string;
    page?: string;
  };
}

export default async function ProductsServerPage({ searchParams }: ProductsServerPageProps) {
  const query = searchParams.q?.trim() ?? '';
  const active = parseActiveFilter(searchParams.active);

  const [result, session] = await Promise.all([
    getProductsPage({ q: query, active }, searchParams.page),
    requireSession(),
  ]);

  const canManage = hasPermission(
    session.user.roles.map((ur) => ur.role.code),
    'nsi:manage',
  );

  return (
    <>
      <ProductsPage
        products={result.items}
        canManage={canManage}
        query={query}
        activeFilter={active}
      />
      <div className="px-6 pb-6">
        <Pagination
          pathname="/nsi/products"
          searchParams={searchParams}
          page={result.page}
          hasNextPage={result.hasNextPage}
        />
      </div>
    </>
  );
}
