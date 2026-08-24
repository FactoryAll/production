'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, Dialog, Input, Select } from '@prodtrack/ui';
import { acceptProductionOrderLineAction, reportProductionFactAction, type ReportFactResult } from './actions';
import type { ProductionOrderLine, ProductionOrder, Shift, WorkCenter, Product, DefectReason } from '@prisma/client';

interface ShiftExecutionPageProps {
  lines: Array<
    ProductionOrderLine & {
      order: ProductionOrder & { shift: Shift };
      workCenter: WorkCenter;
      product: Product;
    }
  >;
  defectReasons: DefectReason[];
  employeeId: string | null;
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

type DialogMode = 'accept' | 'report' | null;

function emptyReportForm(): {
  quantity: string;
  factCategory: string;
  defectQuantity: string;
  defectReasonId: string;
  stopsCount: string;
  stopsDurationMinutes: string;
} {
  return {
    quantity: '',
    factCategory: '',
    defectQuantity: '',
    defectReasonId: '',
    stopsCount: '',
    stopsDurationMinutes: '',
  };
}

export default function ShiftExecutionPage({ lines, employeeId, defectReasons }: ShiftExecutionPageProps) {
  function productCategory() {
    if (!dialogState) return undefined;
    const line = lines.find((l) => l.id === dialogState.line.id);
    return line?.product.category;
  }
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dialogState, setDialogState] = useState<{ line: ProductionOrderLine; mode: Exclude<DialogMode, null> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyReportForm());
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof typeof form, string>>>({});

  function openAcceptDialog(line: ProductionOrderLine) {
    setDialogState({ line, mode: 'accept' });
    setError(null);
  }

  function openReportDialog(line: ShiftExecutionPageProps['lines'][number]) {
    setDialogState({ line, mode: 'report' });
    setForm({
      ...emptyReportForm(),
      factCategory: line.product.category === 'MASS' ? 'MASS' : '',
    });
    setError(null);
    setFieldErrors({});
  }

  function closeDialog() {
    setDialogState(null);
    setError(null);
    setFieldErrors({});
  }

  function validateReportForm(): boolean {
    const errors: Partial<Record<keyof typeof form, string>> = {};
    const quantity = Number(form.quantity);
    if (Number.isNaN(quantity) || quantity < 0) {
      errors.quantity = 'Количество должно быть неотрицательным';
    }
    const defectQty = Number(form.defectQuantity);
    if (Number.isNaN(defectQty) || defectQty < 0) {
      errors.defectQuantity = 'Брак должен быть неотрицательным';
    } else if (defectQty > 0 && !form.defectReasonId) {
      errors.defectReasonId = 'Укажите причину брака';
    }
    const stopsCount = Number(form.stopsCount);
    const stopsDuration = Number(form.stopsDurationMinutes);
    const hasCount = !Number.isNaN(stopsCount) && stopsCount > 0;
    const hasDuration = !Number.isNaN(stopsDuration) && stopsDuration > 0;
    if (hasCount !== hasDuration) {
      errors.stopsCount = 'Количество и длительность остановок должны быть заданы вместе';
      errors.stopsDurationMinutes = 'Количество и длительность остановок должны быть заданы вместе';
    }
    if (!form.factCategory) {
      errors.factCategory = 'Выберите категорию факта';
    }
    if (form.factCategory === 'MASS' && productCategory() === 'GP') {
      errors.factCategory = 'Для ГП выберите GP или PF';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function handleAccept() {
    if (!dialogState) return;
    startTransition(async () => {
      const result = await acceptProductionOrderLineAction(dialogState.line.id);
      if (result.success) {
        closeDialog();
        router.refresh();
      } else {
        setError(result.error ?? 'Не удалось подтвердить получение');
      }
    });
  }

  function handleReport() {
    if (!dialogState) return;
    if (!validateReportForm()) return;
    startTransition(async () => {
      const formData = new FormData();
      formData.set('quantity', form.quantity);
      formData.set('factCategory', form.factCategory);
      if (form.defectQuantity) formData.set('defectQuantity', form.defectQuantity);
      if (form.defectReasonId) formData.set('defectReasonId', form.defectReasonId);
      if (form.stopsCount) formData.set('stopsCount', form.stopsCount);
      if (form.stopsDurationMinutes) formData.set('stopsDurationMinutes', form.stopsDurationMinutes);

      const result: ReportFactResult = await reportProductionFactAction(dialogState.line.id, formData);
      if (result.success) {
        closeDialog();
        setForm(emptyReportForm());
        router.refresh();
      } else {
        setError(result.error ?? 'Не удалось внести итог');
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
                  onClick={() => openAcceptDialog(line)}
                  className="w-full"
                >
                  Подтвердить получение
                </Button>
              )}
              {line.status === 'ACCEPTED' && (
                <Button
                  variant="cta"
                  disabled={isPending}
                  onClick={() => openReportDialog(line)}
                  className="w-full"
                >
                  Внести итог
                </Button>
              )}
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={dialogState?.mode === 'accept'}
        onClose={closeDialog}
        title="Подтвердить получение?"
      >
        <div className="space-y-4">
          <p className="text-graphite">
            Подтвердить получение ПЗ по РЦ{' '}
            <strong>{dialogState?.line.workCenterId}</strong>?
          </p>
          <p className="text-graphite">
            Вы отмечаете, что ознакомились с заданием на смену.
          </p>
          {error && <p className="text-sm text-signal-amber">{error}</p>}
          <div className="flex justify-end gap-3">
            <Button
              variant="secondary"
              onClick={closeDialog}
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

      <Dialog
        open={dialogState?.mode === 'report'}
        onClose={closeDialog}
        title="Внести итог смены"
      >
        <div className="space-y-4">
          <p className="text-graphite">
            ПЗ по РЦ <strong>{dialogState?.line.workCenterId}</strong>
          </p>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm text-graphite">Выпуск</label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.quantity}
                onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
              />
              {fieldErrors.quantity && <p className="text-sm text-signal-amber">{fieldErrors.quantity}</p>}
            </div>

            <div>
              <label className="mb-1 block text-sm text-graphite">Категория факта</label>
              {productCategory() === 'MASS' ? (
                <span className="inline-block rounded bg-neutral-200 px-3 py-2 text-sm text-graphite">Масса</span>
              ) : (
                <Select
                  options={[
                    { value: 'GP', label: 'Готовая продукция' },
                    { value: 'PF', label: 'Полуфабрикат' },
                  ]}
                  placeholder="Выберите категорию"
                  value={form.factCategory}
                  onChange={(e) => setForm((f) => ({ ...f, factCategory: e.target.value }))}
                  error={fieldErrors.factCategory}
                />
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm text-graphite">Брак</label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.defectQuantity}
                  onChange={(e) => setForm((f) => ({ ...f, defectQuantity: e.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-graphite">Причина брака</label>
                <Select
                  options={defectReasons.map((reason) => ({ value: reason.id, label: reason.name }))}
                  placeholder="—"
                  value={form.defectReasonId}
                  onChange={(e) => setForm((f) => ({ ...f, defectReasonId: e.target.value }))}
                  error={fieldErrors.defectReasonId}
                />
              </div>
              {fieldErrors.defectQuantity && <p className="col-span-2 text-sm text-signal-amber">{fieldErrors.defectQuantity}</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm text-graphite">Остановки, шт.</label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={form.stopsCount}
                  onChange={(e) => setForm((f) => ({ ...f, stopsCount: e.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-graphite">Длительность, мин.</label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={form.stopsDurationMinutes}
                  onChange={(e) => setForm((f) => ({ ...f, stopsDurationMinutes: e.target.value }))}
                />
              </div>
              {fieldErrors.stopsCount && <p className="col-span-2 text-sm text-signal-amber">{fieldErrors.stopsCount}</p>}
            </div>
          </div>

          {error && <p className="text-sm text-signal-amber">{error}</p>}

          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={closeDialog} disabled={isPending}>
              Отмена
            </Button>
            <Button variant="cta" onClick={handleReport} disabled={isPending}>
              {isPending ? 'Сохранение...' : 'Внести итог'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
