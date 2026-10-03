import { prisma } from '@prodtrack/db';
import { getStockBalance } from '@/lib/stock-service';
import { StockTable } from './_components/stock-table';

export const dynamic = 'force-dynamic';

import { AccessDenied } from '@/components/access-denied';
import { checkPageAccess } from '@/lib/auth/page-guard';

export default async function StockPage() {
  const access = await checkPageAccess('stock:read');
  if (!access.allowed) {
    return <AccessDenied action="просмотр остатков" allowedRoles={['NP', 'OPR', 'KSGP', 'USGP', 'S1C', 'ADM']} requiredPermission='stock:read' />;
  }
  const balances = await getStockBalance(prisma, {});

  return (
    <main className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-graphite">Остатки</h1>
      </div>
      <StockTable balances={balances} />
    </main>
  );
}
