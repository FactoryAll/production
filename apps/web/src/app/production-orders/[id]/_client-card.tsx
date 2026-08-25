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
  ProductionFact,
  DefectReason,
} from '@prisma/client';
import { confirmProductionOrderAction, substituteOperatorAction, cancelProductionOrderAction, correctProductionFactAction } from '../actions';

interface ProductionOrderCardProps {
  order: ProductionOrder & {
    shift: Shift;
    createdBy: Pick<User, 'id' | 'login'>;
    confirmedBy: Pick<User, 'id' | 'login'> | null;
    cancelledBy: Pick<User, 'id' | 'login'> | null;
    lines: Array<
      ProductionOrderLine & {
        workCenter: WorkCenter;
        product: Product;
        operator: Employee | null;
        facts: Array<ProductionFact & { defectReason: DefectReason | null }>;
        workerAssignments: Array<ProductionOrderLineWorkers & { employee: Employee }>;
      }
    >;
  };
  defectReasons: DefectReason[];
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

export default function ProductionOrderCard({ order, defectReasons, userRoles }: ProductionOrderCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [showSubstituteDialog, setShowSubstituteDialog] = useState(false);
  const [substituteLineId, setSubstituteLineId] = useState<string | null>(null);
  const [substituteReason, setSubstituteReason] = useState('');
  const [substituteComment, setSubstituteComment] = useState('');
  const [substituteError, setSubstituteError] = useState<string | null>(null);
  const [showCorrectFactDialog, setShowCorrectFactDialog] = useState(false);
  const [correctFactId, setCorrectFactId] = useState<string | null>(null);
  const [correctQuantity, setCorrectQuantity] = useState('');
  const [correctDefectQuantity, setCorrectDefectQuantity] = useState('');
  const [correctDefectReasonId, setCorrectDefectReasonId] = useState('');
  const [correctStops, setCorrectStops] = useState('');
  const [correctReason, setCorrectReason] = useState('');
  const [correctError, setCorrectError] = useState<string | null>(null);
  const isDraft = order.status === 'DRAFT';
  const canConfirm = isDraft && hasPermission(userRoles, 'production_order:confirm');
  const editableStatuses: ProductionOrderStatus[] = ['DRAFT', 'CONFIRMED', 'IN_PROGRESS'];
  const hasReportedLine = order.lines.some((line) => line.status === 'REPORTED');
  const isCompleted = order.status === 'COMPLETED';
  const isInProgress = order.status === 'IN_PROGRESS';
  const isCancelled = order.status === 'CANCELLED';
  const canEdit =
    editableStatuses.includes(order.status) && !hasReportedLine && hasPermission(userRoles, 'production_order:update');
  const canSubstitute = hasPermission(userRoles, 'production_order:confirm') && !isDraft && !isCompleted && !isCancelled;
  const canCorrectFact = isCompleted && hasPermission(userRoles, 'production_order:confirm');
  const canViewShiftReport = isCompleted && hasPermission(userRoles, 'production_order:read');
  const canCancel =
    (order.status === 'DRAFT' || order.status === 'CONFIRMED') &&
    !hasReportedLine &&
    hasPermission(userRoles, 'production_order:confirm');
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

  function handleCancelSubmit(e: React.FormEvent) {
    e.preventDefault();
    setCancelError(null);
    const trimmedReason = cancelReason.trim();
    if (trimmedReason.length === 0) {
      setCancelError('Укажите причину отмены');
      return;
    }

    const formData = new FormData();
    formData.set('reason', trimmedReason);

    startTransition(async () => {
      const result = await cancelProductionOrderAction(order.id, formData);
      if (result.success) {
        setShowCancelDialog(false);
        router.push('/production-orders');
      } else {
        setCancelError(result.error ?? 'Не удалось отменить ПЗ');
      }
    });
  }

  function openCorrectFactDialog(fact: ProductionFact) {
    setCorrectFactId(fact.id);
    setCorrectQuantity(fact.quantity.toString());
    setCorrectDefectQuantity(fact.defectQuantity.toString());
    setCorrectDefectReasonId(fact.defectReasonId ?? '');
    setCorrectStops(fact.stopsDurationMinutes.toString());
    setCorrectReason('');
    setCorrectError(null);
    setShowCorrectFactDialog(true);
  }

  function handleCorrectFactSubmit(e: React.FormEvent) {
    e.preventDefault();
    setCorrectError(null);
    if (!correctFactId) return;

    const quantity = Number(correctQuantity);
    const defectQuantity = Number(correctDefectQuantity);
    const stops = Number(correctStops);
    const reason = correctReason.trim();

    if (Number.isNaN(quantity) || quantity < 0) {
      setCorrectError('Количество должно быть неотрицательным числом');
      return;
    }
    if (Number.isNaN(defectQuantity) || defectQuantity < 0) {
      setCorrectError('Брак должен быть неотрицательным числом');
      return;
    }
    if (Number.isNaN(stops) || stops < 0 || !Number.isInteger(stops)) {
      setCorrectError('Остановки должны быть целым неотрицательным числом');
      return;
    }
    if (reason.length === 0) {
      setCorrectError('Причина корректировки обязательна');
      return;
    }
    if (defectQuantity > 0 && !correctDefectReasonId) {
      setCorrectError('Укажите причину брака');
      return;
    }

    const formData = new FormData();
    formData.set('quantity', correctQuantity);
    if (correctDefectQuantity) formData.set('defectQuantity', correctDefectQuantity);
    if (correctDefectReasonId) formData.set('defectReasonId', correctDefectReasonId);
    if (correctStops) formData.set('stopsDurationMinutes', correctStops);
    formData.set('correctionReason', reason);

    startTransition(async () => {
      const result = await correctProductionFactAction(correctFactId, formData);
      if (result.success) {
        setShowCorrectFactDialog(false);
        router.refresh();
      } else {
        setCorrectError(result.error ?? 'Не удалось скорректировать факт');
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
          {canViewShiftReport && (
            <Link href={`/shift-reports/${order.id}`}>
              <Button variant="secondary" disabled={isPending}>
                Отчёт за смену
              </Button>
            </Link>
          )}
          {canCancel && (
            <Button variant="danger" onClick={() => {
              setCancelReason('');
              setCancelError(null);
              setShowCancelDialog(true);
            }} disabled={isPending}>
              Отменить ПЗ
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
        <div>
          <span className="text-sm text-neutral-500">Прогресс</span>
          <p className="text-graphite">{reportedCount} из {totalCount} РЦ отчитались</p>
        </div>
        {isCompleted && (
          <div>
            <span className="text-sm text-neutral-500">Завершено</span>
            <p className="text-graphite">{formatDate(order.completedAt)}</p>
          </div>
        )}
        {isCancelled && (
          <>
            <div>
              <span className="text-sm text-neutral-500">Отменено</span>
              <p className="text-graphite">{formatDate(order.cancelledAt)}</p>
            </div>
            <div>
              <span className="text-sm text-neutral-500">Отменил</span>
              <p className="text-graphite">{order.cancelledBy ? order.cancelledBy.login : '—'}</p>
            </div>
            <div className="sm:col-span-2">
              <span className="text-sm text-neutral-500">Причина отмены</span>
              <p className="text-graphite">{order.cancellationReason ?? '—'}</p>
            </div>
          </>
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
                <th className="border-b border-mist-metal px-4 py-3 font-bold text-graphite">Статус</th>
                <th className="border-b border-mist-metal px-4 py-3 font-bold text-graphite">Факт</th>
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
                    {STATUS_LABELS[line.status] ?? line.status}
                  </td>
                  <td className="border-b border-mist-metal px-4 py-3 text-graphite align-top">
                    {line.facts.length > 0 ? (
                      <div className="space-y-2">
                        {line.facts.map((fact) => (
                          <div key={fact.id} className="space-y-1">
                            <p className="text-graphite">
                              Выпуск: {fact.quantity.toString()} | Брак: {fact.defectQuantity.toString()}
                              {fact.defectReason ? ` (${fact.defectReason.name})` : ''}
                              {fact.stopsDurationMinutes > 0 ? ` | Остановки: ${fact.stopsDurationMinutes} мин` : ''}
                            </p>
                            {fact.postCompletionCorrection && (
                              <div className="space-y-1">
                                <span className="inline-flex items-center rounded bg-signal-amber px-2 py-0.5 text-xs font-medium text-graphite">
                                  Скорректировано после закрытия
                                </span>
                                <p className="text-xs text-graphite">Причина: {fact.correctionReason}</p>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      '—'
                    )}
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
                    {canCorrectFact && line.facts.length > 0 && (
                      <div className="space-y-2">
                        {line.facts.map((fact) => (
                          <Button
                            key={fact.id}
                            variant="cta"
                            size="sm"
                            disabled={isPending}
                            onClick={() => openCorrectFactDialog(fact)}
                          >
                            Корректировать факт
                          </Button>
                        ))}
                      </div>
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

      <Dialog open={showCancelDialog} onClose={() => setShowCancelDialog(false)} title="Отменить ПЗ?">
        <form onSubmit={handleCancelSubmit} className="space-y-4">
          <p className="text-graphite">
            ПЗ будет отменено. Операторы получат уведомление. Отменённое ПЗ нельзя восстановить.
          </p>
          <div className="space-y-2">
            <Label htmlFor="cancel-reason">Причина отмены</Label>
            <textarea
              id="cancel-reason"
              value={cancelReason}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setCancelReason(e.target.value)}
              placeholder="Укажите причину отмены"
              required
              rows={3}
              className="flex min-h-[80px] w-full rounded-md border border-mist-metal bg-white px-3 py-2 text-base text-graphite placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-deep-industry-blue"
            />
          </div>
          {cancelError && <p className="text-sm text-signal-amber">{cancelError}</p>}
          <div className="mt-6 flex justify-end gap-3">
            <Button
              variant="secondary"
              type="button"
              onClick={() => setShowCancelDialog(false)}
              disabled={isPending}
            >
              Не отменять
            </Button>
            <Button variant="danger" type="submit" disabled={isPending}>
              {isPending ? 'Отмена...' : 'Отменить ПЗ'}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={showCorrectFactDialog}
        onClose={() => setShowCorrectFactDialog(false)}
        title="Корректировать факт"
      >
        <form onSubmit={handleCorrectFactSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="correct-quantity">Выпуск</Label>
            <input
              id="correct-quantity"
              type="number"
              min="0"
              step="0.01"
              value={correctQuantity}
              onChange={(e) => setCorrectQuantity(e.target.value)}
              required
              className="flex h-10 w-full rounded-md border border-mist-metal bg-white px-3 py-2 text-base text-graphite placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-deep-industry-blue"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="correct-defect-quantity">Брак</Label>
            <input
              id="correct-defect-quantity"
              type="number"
              min="0"
              step="0.01"
              value={correctDefectQuantity}
              onChange={(e) => setCorrectDefectQuantity(e.target.value)}
              className="flex h-10 w-full rounded-md border border-mist-metal bg-white px-3 py-2 text-base text-graphite placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-deep-industry-blue"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="correct-defect-reason">Причина брака</Label>
            <Select
              id="correct-defect-reason"
              value={correctDefectReasonId}
              onChange={(e) => setCorrectDefectReasonId(e.target.value)}
              options={defectReasons.map((reason) => ({ value: reason.id, label: reason.name }))}
              placeholder="Выберите причину"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="correct-stops">Остановки (мин)</Label>
            <input
              id="correct-stops"
              type="number"
              min="0"
              step="1"
              value={correctStops}
              onChange={(e) => setCorrectStops(e.target.value)}
              className="flex h-10 w-full rounded-md border border-mist-metal bg-white px-3 py-2 text-base text-graphite placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-deep-industry-blue"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="correct-reason">Причина корректировки</Label>
            <textarea
              id="correct-reason"
              value={correctReason}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setCorrectReason(e.target.value)}
              placeholder="Укажите причину корректировки факта"
              required
              rows={3}
              className="flex min-h-[80px] w-full rounded-md border border-mist-metal bg-white px-3 py-2 text-base text-graphite placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-deep-industry-blue"
            />
          </div>
          {correctError && <p className="text-sm text-signal-amber">{correctError}</p>}
          <div className="mt-6 flex justify-end gap-3">
            <Button
              variant="secondary"
              type="button"
              onClick={() => setShowCorrectFactDialog(false)}
              disabled={isPending}
            >
              Отмена
            </Button>
            <Button variant="cta" type="submit" disabled={isPending}>
              {isPending ? 'Сохранение...' : 'Сохранить корректировку'}
            </Button>
          </div>
        </form>
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
