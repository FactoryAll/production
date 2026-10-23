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
  // ОПЭ-37 (решение владельца 23.10.2026): строки с нулевым остатком на экран не выводим —
  // это не остаток, а пустая строка. Отрицательные показываем: это сигнал о расхождении.
  const balances = (await getStockBalance(prisma, {})).filter(
    (balance) => Number(balance.quantity) !== 0,
  );

  return (
    <main className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-graphite">Остатки</h1>
      </div>
      <StockTable balances={balances} />
    </main>
  );
}
