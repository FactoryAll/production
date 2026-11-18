export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { prisma } from '@prodtrack/db';
import { AccessDenied } from '@/components/access-denied';
import { checkPageAccess } from '@/lib/auth/page-guard';
import { formatQuantity } from '@/lib/quantity';
import {
  STOCK_ADJUSTMENT_DIRECTION_LABELS,
  stockAdjustmentReasonLabel,
} from '@/lib/stock-adjustment';

/**
 * История корректировок остатков (M05, решение владельца 18.11.2026).
 *
 * Без этого экрана правки остатков невидимы: в журнале движений их видно только по
 * источнику «Корректировка», а кто и почему — уже нет. Документы неизменяемы, поэтому
 * экран только читает.
 */
export default async function StockAdjustmentsPage() {
  const access = await checkPageAccess('stock:adjust');
  if (!access.allowed) {
    return (
      <AccessDenied
        action="просмотр корректировок остатков"
        allowedRoles={['NP', 'ADM']}
        requiredPermission="stock:adjust"
      />
    );
  }

  const adjustments = await prisma.stockAdjustment.findMany({
    include: {
      createdBy: { select: { login: true } },
      lines: {
        include: {
          product: { select: { code: true, name: true, unit: true } },
          warehouse: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  return (
    <main className="p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-graphite">Корректировки остатков</h1>
        <Link href="/stock" className="text-sm text-deep-industry-blue underline">
          К остаткам
        </Link>
      </div>

      {adjustments.length === 0 ? (
        <p className="text-sm text-machine-gray">
          Корректировок ещё не было. Скорректировать остаток можно со экрана «Остатки» — кнопкой
          в строке позиции.
        </p>
      ) : (
        <div className="space-y-4">
          {adjustments.map((adjustment) => (
            <div key={adjustment.id} className="rounded-md border border-mist-metal bg-white p-4">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex flex-wrap items-baseline gap-3">
                  <span className="font-semibold text-graphite">{adjustment.number}</span>
                  <span className="text-sm text-machine-gray">
                    {adjustment.createdAt.toLocaleString('ru-RU')} · {adjustment.createdBy.login}
                  </span>
                  <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-graphite">
                    {stockAdjustmentReasonLabel(adjustment.reasonCode)}
                  </span>
                  {adjustment.compensatesAdjustmentId && (
                    <span className="rounded bg-signal-amber/20 px-2 py-0.5 text-xs text-graphite">
                      встречная корректировка
                    </span>
                  )}
                </div>
              </div>
              <p className="mb-2 text-sm text-graphite">{adjustment.reason}</p>
              {adjustment.basisDocument && (
                <p className="mb-2 text-sm text-machine-gray">Основание: {adjustment.basisDocument}</p>
              )}
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-machine-gray">
                    <th className="py-1">Склад</th>
                    <th className="py-1">Номенклатура</th>
                    <th className="py-1">Категория</th>
                    <th className="py-1">Направление</th>
                    <th className="py-1 text-right">Количество</th>
                  </tr>
                </thead>
                <tbody>
                  {adjustment.lines.map((line) => (
                    <tr key={line.id} className="border-t border-mist-metal/60">
                      <td className="py-1">{line.warehouse.name}</td>
                      <td className="py-1">
                        {line.product.code} — {line.product.name}
                      </td>
                      <td className="py-1">{line.stockCategory}</td>
                      <td className="py-1">
                        {STOCK_ADJUSTMENT_DIRECTION_LABELS[line.direction]}
                      </td>
                      <td className="py-1 text-right">
                        {formatQuantity(line.quantity)} {line.product.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
