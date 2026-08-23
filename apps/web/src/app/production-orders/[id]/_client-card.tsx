'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Card, Dialog, Select, Label } from '@prodtrack/ui';
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
import { confirmProductionOrderAction, substituteOperatorAction } from '../actions';

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

const STATUS_BADGE_CLASS: Record<string, string> = {
  DRAFT: 'bg-neutral-200 text-graphite',
  CONFIRMED: 'bg-deep-industry-blue text-white',
  IN_PROGRESS: 'bg-blue-100 text-graphite',
  COMPLETED: 'bg-green-100 text-graphite',
  CANCELLED: 'bg-signal-amber text-graphite',
};

function formatShift(shift: Shift): string {
  const date = new Date(shift.date).toLocaleDateString('ru-RU');
  return 'Смена ' + shift.number + ' (' + date + ', ' + shift.start + '–' + shift.end + ')';
}

function formatDate(value: Date | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('ru-RU');
}

const SUBSTITUTION_REASON_OPTIONS = [
  { value: 'ILLNESS', label: 'Болезнь' },
  { value: 'NO_SHOW', label: 'Неявка' },
  { value: 'LEFT_SHIFT', label: 'Ушёл во время смены' },
  { value: 'OTHER', label: 'Прочее' },
];

export default function ProductionOrderCard({ order, userRoles }: ProductionOrderCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showSubstituteDialog, setShowSubstituteDialog] = useState(false);
  const [substituteLineId, setSubstituteLineId] = useState<string | null>(null);
  const [substituteReason, setSubstituteReason] = useState('');
  const [substituteComment, setSubstituteComment] = useState('');
  const [substituteError, setSubstituteError] = useState<string | null>(null);
  const isDraft = order.status === 'DRAFT';
  const canConfirm = isDraft && hasPermission(userRoles, 'production_order:confirm');
  const editableStatuses: ProductionOrderStatus[] = ['DRAFT', 'CONFIRMED', 'IN_PROGRESS'];
  const hasReportedLine = order.lines.some((line) => line.status === 'REPORTED');
  const isCompleted = order.status === 'COMPLETED';
  const isInProgress = order.status === 'IN_PROGRESS';
  const canEdit =
    editableStatuses.includes(order.status) && !hasReportedLine && hasPermission(userRoles, 'production_order:update');
  const canSubstitute = hasPermission(userRoles, 'production_order:confirm') && !isDraft && !isCompleted;
  const reportedCount = order.lines.filter((line) => line.status === 'REPORTED').length;
  const totalCount = order.lines.length;

  function handleConfirm() {
    startTransition(async () => {
      const result = await confirmProductionOrderAction(order.id);
      setShowConfirmDialog(false);
      if (result.success) {
        router.refresh();
      }
    });
  }

  function openSubstituteDialog(lineId: string) {
    setSubstituteLineId(lineId);
    setSubstituteReason('');
    setSubstituteComment('');
    setSubstituteError(null);
    setShowSubstituteDialog(true);
  }

  function handleSubstituteSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubstituteError(null);
    if (!substituteLineId) return;
    if (!substituteReason) {
      setSubstituteError('Выберите причину');
      return;
    }
    if (!substituteComment.trim()) {
      setSubstituteError('Комментарий обязателен');
      return;
    }

    const formData = new FormData();
    formData.set('reasonCode', substituteReason);
    formData.set('comment', substituteComment.trim());

    startTransition(async () => {
      const result = await substituteOperatorAction(substituteLineId, formData);
      if (result.success) {
        setShowSubstituteDialog(false);
        router.refresh();
      } else {
        setSubstituteError(result.error ?? 'Не удалось внести итог за Оператора');
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
            <Button variant="cta" onClick={() => setShowConfirmDialog(true)} disabled={isPending}>
              Подтвердить ПЗ
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className={"rounded px-3 py-1 text-sm font-medium " + (STATUS_BADGE_CLASS[order.status] ?? 'bg-neutral-100 text-graphite')}>
          {STATUS_LABELS[order.status] ?? order.status}
        </span>
        {isInProgress && (
          <span className="text-sm text-neutral-500">
            {reportedCount} из {totalCount} РЦ завершили
          </span>
        )}
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
        {isCompleted && (
          <div>
            <span className="text-sm text-neutral-500">Завершено</span>
            <p className="text-graphite">{formatDate(order.completedAt)}</p>
          </div>
        )}
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
                <th className="border-b border-mist-metal px-4 py-3 font-bold text-graphite">Действия</th>
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
                  <td className="border-b border-mist-metal px-4 py-3 text-graphite">
                    {canSubstitute && (line.status === 'ASSIGNED' || line.status === 'ACCEPTED') && (
                      <Button
                        variant="cta"
                        size="sm"
                        disabled={isPending}
                        onClick={() => openSubstituteDialog(line.id)}
                      >
                        Ввести за Оператора
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={showConfirmDialog} onClose={() => setShowConfirmDialog(false)} title="Подтвердить ПЗ?">
        <p className="text-graphite">
          Операторы получат уведомления. После подтверждения корректировка будет возможна только до первого отчёта Оператора.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setShowConfirmDialog(false)} disabled={isPending}>
            Отмена
          </Button>
          <Button variant="cta" onClick={handleConfirm} disabled={isPending}>
            {isPending ? 'Подтверждение...' : 'Подтвердить'}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={showSubstituteDialog}
        onClose={() => setShowSubstituteDialog(false)}
        title="Внести итог за Оператора"
      >
        <form onSubmit={handleSubstituteSubmit} className="space-y-4">
          <div>
            <Label>Оператор</Label>
            <p className="text-graphite">
              {order.lines.find((line) => line.id === substituteLineId)?.operator?.fullName ?? '—'}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="substitute-reason">Причина</Label>
            <Select
              id="substitute-reason"
              value={substituteReason}
              onChange={(e) => setSubstituteReason(e.target.value)}
              options={SUBSTITUTION_REASON_OPTIONS}
              placeholder="Выберите причину"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="substitute-comment">Комментарий</Label>
            <textarea
              id="substitute-comment"
              value={substituteComment}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setSubstituteComment(e.target.value)}
              placeholder="Укажите причину ввода за Оператора"
              required
              rows={3}
              className="flex min-h-[80px] w-full rounded-md border border-mist-metal bg-white px-3 py-2 text-base text-graphite placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-deep-industry-blue"
            />
          </div>
          {substituteError && <p className="text-sm text-signal-amber">{substituteError}</p>}
          <div className="mt-6 flex justify-end gap-3">
            <Button
              variant="secondary"
              type="button"
              onClick={() => setShowSubstituteDialog(false)}
              disabled={isPending}
            >
              Отмена
            </Button>
            <Button variant="cta" type="submit" disabled={isPending}>
              {isPending ? 'Сохранение...' : 'Внести итог'}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
