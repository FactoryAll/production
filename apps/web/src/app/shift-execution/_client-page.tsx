'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, Dialog, Input, Select } from '@prodtrack/ui';
import {
  acceptProductionOrderLineAction,
  reportProductionFactAction,
  correctFactByOperatorAction,
  type ReportFactResult,
  type CorrectFactResult,
} from './actions';
import type {
  ProductionOrderLine,
  ProductionOrder,
  Shift,
  WorkCenter,
  Product,
  DefectReason,
  ProductionFact,
  FactConsumption,
} from '@prisma/client';

interface ShiftExecutionPageProps {
  lines: Array<
    ProductionOrderLine & {
      order: ProductionOrder & { shift: Shift };
      workCenter: WorkCenter;
      product: Product;
      facts: Array<ProductionFact & { consumptions: FactConsumption[] }>;
    }
  >;
  defectReasons: DefectReason[];
  consumableProducts: Product[];
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

type DialogMode = 'accept' | 'report' | 'correct' | null;

interface ConsumptionRow {
  productId: string;
  quantity: string;
}

interface BalanceInfo {
  available: number;
  unit: string;
}

function emptyReportForm(): {
  quantity: string;
  factCategory: string;
  defectQuantity: string;
  defectReasonId: string;
  stopsCount: string;
  stopsDurationMinutes: string;
  consumption: ConsumptionRow[];
} {
  return {
    quantity: '',
    factCategory: '',
    defectQuantity: '',
    defectReasonId: '',
    stopsCount: '',
    stopsDurationMinutes: '',
    consumption: [],
  };
}

export default function ShiftExecutionPage({ lines, employeeId, defectReasons, consumableProducts }: ShiftExecutionPageProps) {
  function productCategory() {
    if (!dialogState) return undefined;
    const line = lines.find((l) => l.id === dialogState.line.id);
    return line?.product.category;
  }

  function workCenterProducesMass() {
    if (!dialogState) return true;
    const line = lines.find((l) => l.id === dialogState.line.id);
    return line?.workCenter.producesMass ?? true;
  }

  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dialogState, setDialogState] = useState<{ line: ProductionOrderLine; mode: Exclude<DialogMode, null> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyReportForm());
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof typeof form, string>>>({});
  const [balances, setBalances] = useState<Record<string, BalanceInfo | null>>({});
  const [warnings, setWarnings] = useState<string[] | null>(null);

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
    setBalances({});
    setWarnings(null);
  }

  function openCorrectDialog(line: ShiftExecutionPageProps['lines'][number]) {
    const fact = line.facts[0];
    setDialogState({ line, mode: 'correct' });
    setForm({
      quantity: fact ? String(fact.quantity) : '',
      factCategory: fact ? fact.factCategory : line.product.category === 'MASS' ? 'MASS' : '',
      defectQuantity: fact ? String(fact.defectQuantity) : '',
      defectReasonId: fact?.defectReasonId ?? '',
      stopsCount: fact ? String(fact.stopsCount) : '',
      stopsDurationMinutes: fact ? String(fact.stopsDurationMinutes) : '',
      consumption:
        fact?.consumptions.map((c) => ({
          productId: c.productId,
          quantity: c.quantity.toString(),
        })) ?? [],
    });
    if (fact?.consumptions) {
      fact.consumptions.forEach((c) => void fetchBalance(c.productId));
    }
    setError(null);
    setFieldErrors({});
    setWarnings(null);
  }

  function closeDialog() {
    setDialogState(null);
    setError(null);
    setFieldErrors({});
    setBalances({});
    setWarnings(null);
  }

  async function fetchBalance(productId: string) {
    const { getAvailableBalanceAction } = await import('./actions');
    const result = await getAvailableBalanceAction(productId);
    if (result.success) {
      setBalances((prev) => ({ ...prev, [productId]: result.balance }));
    }
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

    const seen = new Set<string>();
    for (const row of form.consumption) {
      if (!row.productId) {
        errors.consumption = 'Выберите продукт в строке потребления';
        break;
      }
      if (seen.has(row.productId)) {
        errors.consumption = 'Продукт в потреблении не может повторяться';
        break;
      }
      seen.add(row.productId);
      const q = Number(row.quantity);
      if (Number.isNaN(q) || q <= 0) {
        errors.consumption = 'Количество потребления должно быть больше 0';
        break;
      }
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

  function addConsumptionRow() {
    setForm((f) => ({ ...f, consumption: [...f.consumption, { productId: '', quantity: '' }] }));
  }

  function removeConsumptionRow(index: number) {
    setForm((f) => ({
      ...f,
      consumption: f.consumption.filter((_, i) => i !== index),
    }));
  }

  function updateConsumptionRow(index: number, patch: Partial<ConsumptionRow>) {
    setForm((f) => ({
      ...f,
      consumption: f.consumption.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));
    if (patch.productId) {
      void fetchBalance(patch.productId);
    }
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
      if (form.consumption.length > 0) {
        formData.set(
          'consumption',
          JSON.stringify(
            form.consumption
              .filter((row) => row.productId && row.quantity)
              .map((row) => ({ productId: row.productId, quantity: Number(row.quantity) })),
          ),
        );
      }

      const result: ReportFactResult = await reportProductionFactAction(dialogState.line.id, formData);
      if (result.success) {
        closeDialog();
        setForm(emptyReportForm());
        if (result.warnings && result.warnings.length > 0) {
          setWarnings(result.warnings);
        }
        router.refresh();
      } else {
        setError(result.error ?? 'Не удалось внести итог');
      }
    });
  }

  function handleCorrect() {
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
      if (form.consumption.length > 0) {
        formData.set(
          'consumption',
          JSON.stringify(
            form.consumption
              .filter((row) => row.productId && row.quantity)
              .map((row) => ({ productId: row.productId, quantity: Number(row.quantity) })),
          ),
        );
      }

      const result: CorrectFactResult = await correctFactByOperatorAction(dialogState.line.id, formData);
      if (result.success) {
        closeDialog();
        if (result.warnings && result.warnings.length > 0) {
          setWarnings(result.warnings);
        }
        router.refresh();
      } else {
        setError(result.error ?? 'Не удалось скорректировать факт');
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

      {warnings && warnings.length > 0 && (
        <div className="rounded-md bg-signal-amber/10 p-4 text-signal-amber">
          <ul className="list-disc space-y-1 pl-5">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

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
              {line.status === 'REPORTED' && line.order.status !== 'COMPLETED' && (
                <Button
                  variant="secondary"
                  disabled={isPending}
                  onClick={() => openCorrectDialog(line)}
                  className="w-full"
                >
                  Корректировать факт
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
        open={dialogState?.mode === 'report' || dialogState?.mode === 'correct'}
        onClose={closeDialog}
        title={dialogState?.mode === 'correct' ? 'Корректировать факт' : 'Внести итог смены'}
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

            {!workCenterProducesMass() && (
              <div className="rounded-md border border-neutral-200 p-3">
                <p className="mb-2 text-sm font-medium text-graphite">Потребление</p>
                {form.consumption.map((row, index) => {
                  const selectedProduct = consumableProducts.find((p) => p.id === row.productId);
                  const balance = row.productId ? balances[row.productId] : null;
                  const quantityNum = Number(row.quantity);
                  const showWarning = balance && !Number.isNaN(quantityNum) && quantityNum > balance.available && balance.available >= 0;
                  return (
                    <div key={index} className="mb-3 grid grid-cols-[1fr_1fr_auto] gap-2">
                      <Select
                        options={consumableProducts.map((p) => ({ value: p.id, label: `${p.name} (${p.unit})` }))}
                        placeholder="Продукт"
                        value={row.productId}
                        onChange={(e) => updateConsumptionRow(index, { productId: e.target.value })}
                      />
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        placeholder={selectedProduct ? `Количество, ${selectedProduct.unit}` : 'Количество'}
                        value={row.quantity}
                        onChange={(e) => updateConsumptionRow(index, { quantity: e.target.value })}
                      />
                      <Button
                        variant="secondary"
                        type="button"
                        onClick={() => removeConsumptionRow(index)}
                        disabled={isPending}
                      >
                        ×
                      </Button>
                      {balance && (
                        <p className="col-span-3 text-xs text-neutral-500">
                          Доступно: {balance.available} {balance.unit}
                        </p>
                      )}
                      {showWarning && (
                        <p className="col-span-3 text-sm text-signal-amber">
                          Превышение остатка на {(quantityNum - balance!.available).toFixed(2)} {balance!.unit}; будет записано с предупреждением
                        </p>
                      )}
                    </div>
                  );
                })}
                <Button
                  variant="secondary"
                  type="button"
                  onClick={addConsumptionRow}
                  disabled={isPending}
                  className="w-full"
                >
                  Добавить строку потребления
                </Button>
                {fieldErrors.consumption && <p className="mt-2 text-sm text-signal-amber">{fieldErrors.consumption}</p>}
              </div>
            )}
          </div>

          {error && <p className="text-sm text-signal-amber">{error}</p>}

          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={closeDialog} disabled={isPending}>
              Отмена
            </Button>
            {dialogState?.mode === 'correct' ? (
              <Button variant="cta" onClick={handleCorrect} disabled={isPending}>
                {isPending ? 'Сохранение...' : 'Сохранить корректировку'}
              </Button>
            ) : (
              <Button variant="cta" onClick={handleReport} disabled={isPending}>
                {isPending ? 'Сохранение...' : 'Внести итог'}
              </Button>
            )}
          </div>
        </div>
      </Dialog>
    </div>
  );
}
