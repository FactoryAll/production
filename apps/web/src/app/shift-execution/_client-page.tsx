'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, Dialog } from '@prodtrack/ui';
import { acceptProductionOrderLineAction } from './actions';
import type { ProductionOrderLine, ProductionOrder, Shift, WorkCenter, Product } from '@prisma/client';

interface ShiftExecutionPageProps {
  lines: Array<
    ProductionOrderLine & {
      order: ProductionOrder & { shift: Shift };
      workCenter: WorkCenter;
      product: Product;
    }
  >;
  employeeId: string | null;
  userRoles: string[];
}

const STATUS_LABELS: Record<string, string> = {
  ASSIGNED: 'Назначено',
  ACCEPTED: 'Принято',
  REPORTED: 'Завершено',
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  ASSIGNED: 'bg-neutral-200 text-graphite',
  ACCEPTED: 'bg-deep-industry-blue text-white',
  REPORTED: 'bg-green-100 text-graphite',
};

export default function ShiftExecutionPage({ lines, employeeId }: ShiftExecutionPageProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dialogLine, setDialogLine] = useState<ProductionOrderLine | null>(null);
  const [error, setError] = useState<string | null>(null);

  function openDialog(line: ProductionOrderLine) {
    setDialogLine(line);
    setError(null);
  }

  function handleAccept() {
    if (!dialogLine) return;
    startTransition(async () => {
      const result = await acceptProductionOrderLineAction(dialogLine.id);
      if (result.success) {
        setDialogLine(null);
        router.refresh();
      } else {
        setError(result.error ?? 'Не удалось подтвердить получение');
      }
    });
  }

  if (!employeeId) {
    return (
      <div className="space-y-4 p-6">
        <h1 className="text-2xl font-semibold text-graphite">Исполнение смены</h1>
        <p className="text-graphite">Вы не привязаны к сотруднику. Обратитесь к администратору.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      <h1 className="text-2xl font-semibold text-graphite">Исполнение смены</h1>

      {lines.length === 0 ? (
        <p className="text-graphite">Нет активных заданий на смену.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {lines.map((line) => (
            <Card key={line.id} className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <span className={"rounded px-3 py-1 text-sm font-medium " + (STATUS_BADGE_CLASS[line.status] ?? 'bg-neutral-100 text-graphite')}>
                  {STATUS_LABELS[line.status] ?? line.status}
                </span>
                <span className="text-sm text-neutral-500">
                  ПЗ {line.order.id.slice(0, 8)}
                </span>
              </div>
              <div>
                <p className="text-graphite font-medium">
                  {line.workCenter.code} — {line.workCenter.name}
                </p>
                <p className="text-sm text-neutral-500">
                  {line.product.name} ({line.product.unit}) — {line.plannedQuantity.toString()}
                </p>
                <p className="text-sm text-neutral-500">
                  Смена {line.order.shift.number},{' '}
                  {new Date(line.order.shift.date).toLocaleDateString('ru-RU')}
                </p>
              </div>
              {line.status === 'ASSIGNED' && (
                <Button
                  variant="cta"
                  disabled={isPending}
                  onClick={() => openDialog(line)}
                  className="w-full"
                >
                  Подтвердить получение
                </Button>
              )}
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={!!dialogLine}
        onClose={() => setDialogLine(null)}
        title="Подтвердить получение?"
      >
        <div className="space-y-4">
          <p className="text-graphite">
            Подтвердить получение ПЗ по РЦ{' '}
            <strong>{dialogLine?.workCenterId}</strong>?
          </p>
          <p className="text-graphite">
            Вы отмечаете, что ознакомились с заданием на смену.
          </p>
          {error && <p className="text-sm text-signal-amber">{error}</p>}
          <div className="flex justify-end gap-3">
            <Button
              variant="secondary"
              onClick={() => setDialogLine(null)}
              disabled={isPending}
            >
              Отмена
            </Button>
            <Button variant="cta" onClick={handleAccept} disabled={isPending}>
              {isPending ? 'Подтверждение...' : 'Подтвердить'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
