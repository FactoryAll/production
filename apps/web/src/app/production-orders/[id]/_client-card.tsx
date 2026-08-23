'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Card, Dialog } from '@prodtrack/ui';
import { hasPermission } from '@prodtrack/contracts';
import type {
  ProductionOrder,
  ProductionOrderLine,
  ProductionOrderStatus,
  Shift,
  WorkCenter,
  Product,
  Employee,
  User,
  ProductionOrderLineWorkers,
} from '@prisma/client';
import { confirmProductionOrderAction } from '../actions';

interface ProductionOrderCardProps {
  order: ProductionOrder & {
    shift: Shift;
    createdBy: Pick<User, 'id' | 'login'>;
    confirmedBy: Pick<User, 'id' | 'login'> | null;
    lines: Array<
      ProductionOrderLine & {
        workCenter: WorkCenter;
        product: Product;
        operator: Employee | null;
        workerAssignments: Array<ProductionOrderLineWorkers & { employee: Employee }>;
      }
    >;
  };
  userRoles: string[];
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Черновик',
  CONFIRMED: 'Подтверждено',
  IN_PROGRESS: 'В работе',
  COMPLETED: 'Завершено',
  CANCELLED: 'Отменено',
};

function formatShift(shift: Shift): string {
  const date = new Date(shift.date).toLocaleDateString('ru-RU');
  return 'Смена ' + shift.number + ' (' + date + ', ' + shift.start + '–' + shift.end + ')';
}

function formatDate(value: Date | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('ru-RU');
}

export default function ProductionOrderCard({ order, userRoles }: ProductionOrderCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showDialog, setShowDialog] = useState(false);
  const isDraft = order.status === 'DRAFT';
  const canConfirm = isDraft && hasPermission(userRoles, 'production_order:confirm');
  const editableStatuses: ProductionOrderStatus[] = ['DRAFT', 'CONFIRMED', 'IN_PROGRESS'];
  const hasReportedLine = order.lines.some((line) => line.status === 'REPORTED');
  const canEdit =
    editableStatuses.includes(order.status) && !hasReportedLine && hasPermission(userRoles, 'production_order:update');

  function handleConfirm() {
    startTransition(async () => {
      const result = await confirmProductionOrderAction(order.id);
      setShowDialog(false);
      if (result.success) {
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Link href="/production-orders" className="text-sm text-neutral-500 hover:text-graphite">
            ← К списку ПЗ
          </Link>
          <h1 className="text-2xl font-semibold text-graphite">
            ПЗ {order.id.slice(0, 8)} — {STATUS_LABELS[order.status] ?? order.status}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {canEdit && (
            <Link href={'/production-orders/' + order.id + '/edit'}>
              <Button variant="cta" disabled={isPending}>
                Редактировать ПЗ
              </Button>
            </Link>
          )}
          {canConfirm && (
            <Button variant="cta" onClick={() => setShowDialog(true)} disabled={isPending}>
              Подтвердить ПЗ
            </Button>
          )}
        </div>
      </div>

      <Card className="grid gap-4 sm:grid-cols-2">
        <div>
          <span className="text-sm text-neutral-500">Смена</span>
          <p className="text-graphite">{formatShift(order.shift)}</p>
        </div>
        <div>
          <span className="text-sm text-neutral-500">Дата создания</span>
          <p className="text-graphite">{formatDate(order.createdAt)}</p>
        </div>
        <div>
          <span className="text-sm text-neutral-500">Создал</span>
          <p className="text-graphite">{order.createdBy.login}</p>
        </div>
        <div>
          <span className="text-sm text-neutral-500">Подтвердил</span>
          <p className="text-graphite">
            {order.confirmedBy ? order.confirmedBy.login : '—'}
            {order.confirmedAt && ' (' + formatDate(order.confirmedAt) + ')'}
          </p>
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="text-lg font-medium text-graphite">Строки ПЗ</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-base font-sans">
            <thead className="bg-graphite-surface">
              <tr>
                <th className="border-b border-mist-metal px-4 py-3 font-bold text-graphite">РЦ</th>
                <th className="border-b border-mist-metal px-4 py-3 font-bold text-graphite">Номенклатура</th>
                <th className="border-b border-mist-metal px-4 py-3 font-bold text-graphite">Количество</th>
                <th className="border-b border-mist-metal px-4 py-3 font-bold text-graphite">Оператор</th>
                <th className="border-b border-mist-metal px-4 py-3 font-bold text-graphite">Работники</th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((line) => (
                <tr key={line.id} className="hover:bg-neutral-100">
                  <td className="border-b border-mist-metal px-4 py-3 text-graphite">
                    {line.workCenter.code} — {line.workCenter.name}
                  </td>
                  <td className="border-b border-mist-metal px-4 py-3 text-graphite">
                    {line.product.code} — {line.product.name} ({line.product.unit})
                  </td>
                  <td className="border-b border-mist-metal px-4 py-3 text-graphite">
                    {line.plannedQuantity.toString()}
                  </td>
                  <td className="border-b border-mist-metal px-4 py-3 text-graphite">
                    {line.operator ? line.operator.fullName : '—'}
                  </td>
                  <td className="border-b border-mist-metal px-4 py-3 text-graphite">
                    {line.workerAssignments.length > 0
                      ? line.workerAssignments.map((wa) => wa.employee.fullName).join(', ')
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={showDialog} onClose={() => setShowDialog(false)} title="Подтвердить ПЗ?">
        <p className="text-graphite">
          Операторы получат уведомления. После подтверждения корректировка будет возможна только до первого отчёта Оператора.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setShowDialog(false)} disabled={isPending}>
            Отмена
          </Button>
          <Button variant="cta" onClick={handleConfirm} disabled={isPending}>
            {isPending ? 'Подтверждение...' : 'Подтвердить'}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
