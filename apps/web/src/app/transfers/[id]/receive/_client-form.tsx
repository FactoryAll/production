'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Input, Card } from '@prodtrack/ui';
import type { GoodsTransfer, TransferLine, Warehouse, Product, User } from '@prisma/client';
import { receiveGoodsTransferAction } from '../../actions';

interface ReceiveTransferFormProps {
  transfer: GoodsTransfer & {
    sourceWarehouse: Warehouse;
    destinationWarehouse: Warehouse;
    submittedBy: Pick<User, 'id' | 'login'> | null;
    lines: Array<TransferLine & { product: Product }>;
  };
}

interface LineInput {
  transferLineId: string;
  actualQuantity: string;
}

function lineToInput(line: TransferLine): LineInput {
  return {
    transferLineId: line.id,
    actualQuantity: line.plannedQuantity.toString(),
  };
}

function toDecimal(value: number | string): number {
  return Number(value);
}

export default function ReceiveTransferForm({ transfer }: ReceiveTransferFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [lines, setLines] = useState<LineInput[]>(transfer.lines.map(lineToInput));
  const [error, setError] = useState<string | null>(null);

  function updateLine(transferLineId: string, actualQuantity: string) {
    setLines((prev) => prev.map((line) => (line.transferLineId === transferLineId ? { ...line, actualQuantity } : line)));
  }

  const discrepancies = transfer.lines.map((line) => {
    const input = lines.find((l) => l.transferLineId === line.id);
    const actual = input ? toDecimal(input.actualQuantity) : toDecimal(line.plannedQuantity.toString());
    const planned = toDecimal(line.plannedQuantity.toString());
    return { line, actual, planned, diff: actual - planned };
  });

  const discrepancyCount = discrepancies.filter((d) => d.diff !== 0).length;

  function validate(): string | null {
    for (const line of lines) {
      const value = toDecimal(line.actualQuantity);
      if (Number.isNaN(value)) {
        return 'Укажите корректное количество';
      }
      if (value < 0) {
        return 'Количество не может быть отрицательным';
      }
    }
    return null;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    const payloadLines = lines.map((line) => ({
      transferLineId: line.transferLineId,
      actualQuantity: toDecimal(line.actualQuantity),
    }));

    const formData = new FormData();
    formData.set('lines', JSON.stringify(payloadLines));

    startTransition(async () => {
      const result = await receiveGoodsTransferAction(transfer.id, formData);
      if (result.success) {
        router.push(`/transfers/${transfer.id}`);
      } else {
        setError(result.error ?? 'Не удалось принять перемещение');
      }
    });
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Link href={`/transfers/${transfer.id}`} className="text-sm text-neutral-500 hover:text-graphite">
            ← К карточке перемещения
          </Link>
          <h1 className="text-2xl font-semibold text-graphite">
            Приёмка перемещения {transfer.id.slice(0, 8)}
          </h1>
        </div>
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
          <h2 className="text-lg font-medium text-graphite">Строки перемещения</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-base font-sans">
              <thead className="bg-graphite-surface">
                <tr>
                  <th className="border-b border-mist-metal px-4 py-3 font-bold text-graphite">Продукт</th>
                  <th className="border-b border-mist-metal px-4 py-3 font-bold text-graphite">Плановое количество</th>
                  <th className="border-b border-mist-metal px-4 py-3 font-bold text-graphite">Фактическое количество</th>
                  <th className="border-b border-mist-metal px-4 py-3 font-bold text-graphite">Расхождение</th>
                </tr>
              </thead>
              <tbody>
                {discrepancies.map(({ line, planned, diff }) => {
                  const input = lines.find((l) => l.transferLineId === line.id);
                  const hasDiscrepancy = diff !== 0;
                  return (
                    <tr key={line.id} className={hasDiscrepancy ? 'bg-signal-amber/10' : 'hover:bg-neutral-100'}>
                      <td className="border-b border-mist-metal px-4 py-3 text-graphite">
                        {line.product.code} — {line.product.name} ({line.product.unit})
                      </td>
                      <td className="border-b border-mist-metal px-4 py-3 text-graphite">{planned.toFixed(2)}</td>
                      <td className="border-b border-mist-metal px-4 py-3">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={input?.actualQuantity ?? ''}
                          onChange={(e) => updateLine(line.id, e.target.value)}
                          className="max-w-[160px]"
                          required
                        />
                      </td>
                      <td className="border-b border-mist-metal px-4 py-3 text-graphite">
                        {hasDiscrepancy ? (
                          <span className="font-medium text-signal-amber">
                            {diff > 0 ? '+' : ''}
                            {diff.toFixed(2)}
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

          {discrepancyCount > 0 && (
            <p className="text-sm text-signal-amber">Расхождений: {discrepancyCount}. Статус приёмки будет «Расхождение».</p>
          )}
          {discrepancyCount === 0 && (
            <p className="text-sm text-neutral-500">Расхождений нет. Статус приёмки будет «Принято».</p>
          )}
        </Card>

        {error && <p className="text-sm text-signal-amber">{error}</p>}

        <div className="flex items-center justify-end gap-3">
          <Link href={`/transfers/${transfer.id}`}>
            <Button type="button" variant="secondary" disabled={isPending}>Отмена</Button>
          </Link>
          <Button type="submit" variant="cta" disabled={isPending}>
            {isPending ? 'Приёмка...' : 'Принять'}
          </Button>
        </div>
      </form>
    </div>
  );
}
