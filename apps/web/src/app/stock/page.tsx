import { prisma } from '@prodtrack/db';
import { requirePermission } from '@/lib/auth/access';
import { getStockBalance } from '@/lib/stock-service';
import { StockTable } from './_components/stock-table';

export const dynamic = 'force-dynamic';

export default async function StockPage() {
  await requirePermission('stock:read');
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
