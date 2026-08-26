'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Card, Dialog } from '@prodtrack/ui';
import { hasPermission } from '@prodtrack/contracts';
import type { GoodsTransfer, TransferLine, Warehouse, Product, User } from '@prisma/client';
import { transferStatusLabel, submitGoodsTransferAction } from '../actions';

interface TransferCardProps {
  transfer: GoodsTransfer & {
    sourceWarehouse: Warehouse;
    destinationWarehouse: Warehouse;
    submittedBy: Pick<User, 'id' | 'login'> | null;
    lines: Array<TransferLine & { product: Product }>;
  };
  userRoles: string[];
}

const STATUS_BADGE_CLASS: Record<GoodsTransfer['status'], string> = {
  DRAFT: 'bg-neutral-200 text-graphite',
  SUBMITTED: 'bg-deep-industry-blue text-white',
  RECEIVED: 'bg-green-100 text-graphite',
  DISCREPANCY: 'bg-signal-amber text-graphite',
  RECONCILED: 'bg-blue-100 text-graphite',
  CANCELLED: 'bg-red-100 text-graphite',
};

function formatDate(value: Date | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('ru-RU');
}

export default function TransferCard({ transfer, userRoles }: TransferCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isDraft = transfer.status === 'DRAFT';
  const canSubmit = isDraft && hasPermission(userRoles, 'transfer:update');
  const canEdit = isDraft && hasPermission(userRoles, 'transfer:create');

  function handleSubmit() {
    setSubmitError(null);
    startTransition(async () => {
      const result = await submitGoodsTransferAction(transfer.id);
      setShowSubmitDialog(false);
      if (result.success) {
        router.refresh();
      } else {
        setSubmitError(result.error ?? 'Не удалось отправить перемещение');
      }
    });
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Link href="/transfers" className="text-sm text-neutral-500 hover:text-graphite">
            ← К списку перемещений
          </Link>
          <h1 className="text-2xl font-semibold text-graphite">
            Перемещение {transfer.id.slice(0, 8)} — {transferStatusLabel(transfer.status)}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {canEdit && (
            <Link href={`/transfers/${transfer.id}/edit`}>
              <Button variant="secondary" disabled={isPending}>Редактировать</Button>
            </Link>
          )}
          {canSubmit && (
            <Button variant="cta" onClick={() => setShowSubmitDialog(true)} disabled={isPending}>
              Отправить
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span
          className={
            'rounded px-3 py-1 text-sm font-medium ' + (STATUS_BADGE_CLASS[transfer.status] ?? 'bg-neutral-100 text-graphite')
          }
        >
          {transferStatusLabel(transfer.status)}
        </span>
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
        <div>
          <span className="text-sm text-neutral-500">Дата создания</span>
          <p className="text-graphite">{formatDate(transfer.createdAt)}</p>
        </div>
        {transfer.status === 'SUBMITTED' && (
          <>
            <div>
              <span className="text-sm text-neutral-500">Отправлено</span>
              <p className="text-graphite">{formatDate(transfer.submittedAt)}</p>
            </div>
            <div>
              <span className="text-sm text-neutral-500">Отправил</span>
              <p className="text-graphite">{transfer.submittedBy ? transfer.submittedBy.login : '—'}</p>
            </div>
          </>
        )}
      </Card>

      <Card className="space-y-4">
        <h2 className="text-lg font-medium text-graphite">Строки перемещения</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-base font-sans">
            <thead className="bg-graphite-surface">
              <tr>
                <th className="border-b border-mist-metal px-4 py-3 font-bold text-graphite">Продукт</th>
                <th className="border-b border-mist-metal px-4 py-3 font-bold text-graphite">Плановое количество</th>
              </tr>
            </thead>
            <tbody>
              {transfer.lines.map((line) => (
                <tr key={line.id} className="hover:bg-neutral-100">
                  <td className="border-b border-mist-metal px-4 py-3 text-graphite">
                    {line.product.code} — {line.product.name} ({line.product.unit})
                  </td>
                  <td className="border-b border-mist-metal px-4 py-3 text-graphite">
                    {line.plannedQuantity.toString()}
                  </td>
                </tr>
              ))}
              {transfer.lines.length === 0 && (
                <tr>
                  <td colSpan={2} className="px-4 py-6 text-center text-neutral-500">
                    Нет строк
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={showSubmitDialog} onClose={() => setShowSubmitDialog(false)} title="Отправить перемещение?">
        <p className="text-graphite">
          Остатки ГП будут списаны с Производственного склада. КСГП получит уведомление о приёмке.
        </p>
        {submitError && <p className="mt-2 text-sm text-signal-amber">{submitError}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setShowSubmitDialog(false)} disabled={isPending}>
            Отмена
          </Button>
          <Button variant="cta" onClick={handleSubmit} disabled={isPending}>
            {isPending ? 'Отправка...' : 'Отправить'}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
