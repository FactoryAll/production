'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Input, Card } from '@prodtrack/ui';
import type { GoodsTransfer, TransferLine, Warehouse, Product, User, Discrepancy } from '@prisma/client';
import { reconcileDiscrepanciesAction } from '../../actions';

interface ReconcileFormProps {
  transfer: GoodsTransfer & {
    sourceWarehouse: Warehouse;
    destinationWarehouse: Warehouse;
    submittedBy: Pick<User, 'id' | 'login'> | null;
    lines: Array<TransferLine & { product: Product; discrepancies: Discrepancy[] }>;
  };
}

interface DiscrepancyInput {
  discrepancyId: string;
  reconciledQuantity: string;
}

function toDecimal(value: number | string): number {
  return Number(value);
}

export default function ReconcileForm({ transfer }: ReconcileFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [items, setItems] = useState<DiscrepancyInput[]>(
    transfer.lines
      .flatMap((line) => line.discrepancies)
      .map((d) => ({
        discrepancyId: d.id,
        reconciledQuantity: d.actualQuantity.toString(),
      })),
  );
  const [error, setError] = useState<string | null>(null);

  function updateItem(discrepancyId: string, reconciledQuantity: string) {
    setItems((prev) =>
      prev.map((item) => (item.discrepancyId === discrepancyId ? { ...item, reconciledQuantity } : item)),
    );
  }

  function validate(): string | null {
    for (const item of items) {
      const value = toDecimal(item.reconciledQuantity);
      if (Number.isNaN(value)) {
        return 'Укажите корректное количество';
      }
      if (value < 0) {
        return 'Согласованное количество не может быть отрицательным';
      }
    }
    return null;
  }

  const discrepancyRows = transfer.lines
    .flatMap((line) =>
      line.discrepancies.map((d) => ({
        discrepancy: d,
        line,
        input: items.find((i) => i.discrepancyId === d.id),
      })),
    )
    .filter((row): row is typeof row & { input: DiscrepancyInput } => Boolean(row.input));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    const payload = items.map((item) => ({
      discrepancyId: item.discrepancyId,
      reconciledQuantity: toDecimal(item.reconciledQuantity),
    }));

    const formData = new FormData();
    formData.set('discrepancies', JSON.stringify(payload));

    startTransition(async () => {
      const result = await reconcileDiscrepanciesAction(transfer.id, formData);
      if (result.success) {
        router.push(`/transfers/${transfer.id}`);
      } else {
        setError(result.error ?? 'Не удалось согласовать расхождения');
      }
    });
  }

  return (
    <div className="space-y-4 p-6">
      <div className="space-y-1">
        <Link href={`/transfers/${transfer.id}`} className="text-sm text-neutral-500 hover:text-graphite">
          ← К карточке перемещения
        </Link>
        <h1 className="text-2xl font-semibold text-graphite">Согласование расхождений</h1>
      </div>

      <Card className="grid gap-4 sm:grid-cols-2">
        <div>
          <span className="text-sm text-neutral-500">Склад-источник</span>
          <p className="text-graphite">{transfer.sourceWarehouse.name}</p>
        </div>
        <div>
          <span className="text-sm text-neutral-500">Склад-приёмник</span>
          <p className="text-graphite">{transfer.destinationWarehouse.name}</p>
        </div>
      </Card>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="space-y-4">
          <h2 className="text-lg font-medium text-graphite">Расхождения</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-base font-sans">
              <thead className="bg-graphite-surface">
                <tr>
                  <th className="border-b border-mist-metal px-4 py-3 font-bold text-graphite">Продукт</th>
                  <th className="border-b border-mist-metal px-4 py-3 font-bold text-graphite">Плановое</th>
                  <th className="border-b border-mist-metal px-4 py-3 font-bold text-graphite">Фактическое</th>
                  <th className="border-b border-mist-metal px-4 py-3 font-bold text-graphite">Согласованное</th>
                  <th className="border-b border-mist-metal px-4 py-3 font-bold text-graphite">Корректировка</th>
                </tr>
              </thead>
              <tbody>
                {discrepancyRows.map(({ discrepancy, line, input }) => {
                  const reconciled = toDecimal(input.reconciledQuantity);
                  const actual = toDecimal(discrepancy.actualQuantity.toString());
                  const delta = reconciled - actual;
                  const hasAdjustment = delta !== 0;
                  return (
                    <tr key={discrepancy.id} className={hasAdjustment ? 'bg-signal-amber/10' : 'hover:bg-neutral-100'}>
                      <td className="border-b border-mist-metal px-4 py-3 text-graphite">
                        {line.product.code} — {line.product.name} ({line.product.unit})
                      </td>
                      <td className="border-b border-mist-metal px-4 py-3 text-graphite">
                        {discrepancy.plannedQuantity.toString()}
                      </td>
                      <td className="border-b border-mist-metal px-4 py-3 text-graphite">
                        {discrepancy.actualQuantity.toString()}
                      </td>
                      <td className="border-b border-mist-metal px-4 py-3">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={input.reconciledQuantity}
                          onChange={(e) => updateItem(discrepancy.id, e.target.value)}
                          className="max-w-[160px]"
                          required
                        />
                      </td>
                      <td className="border-b border-mist-metal px-4 py-3 text-graphite">
                        {hasAdjustment ? (
                          <span className="font-medium text-signal-amber">
                            {delta > 0 ? '+' : ''}
                            {delta.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-neutral-500">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {error && <p className="text-sm text-signal-amber">{error}</p>}

        <div className="flex items-center justify-end gap-3">
          <Link href={`/transfers/${transfer.id}`}>
            <Button type="button" variant="secondary" disabled={isPending}>
              Отмена
            </Button>
          </Link>
          <Button type="submit" variant="cta" disabled={isPending}>
            {isPending ? 'Согласование...' : 'Согласовать'}
          </Button>
        </div>
      </form>
    </div>
  );
}
