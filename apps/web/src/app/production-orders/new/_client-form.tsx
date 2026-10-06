'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Select, Input, Label, CheckboxList, Card } from '@prodtrack/ui';
import { createProductionOrderAction } from '../actions';
import type { ProductionOrderLineInput } from '@/lib/validation/production-order';
import type { WorkCenter, Product, Employee } from '@prisma/client';
import {
  buildEmployeeOptions,
  isEligible,
  NOT_OPERATOR_NOTE,
  NOT_WORKER_NOTE,
} from '../employee-options';

interface ProductionOrderFormProps {
  workCenters: WorkCenter[];
  products: Product[];
  /** Сотрудники с признаком допуска — только они попадают в список «Работники» (T-071). */
  workerEmployees: Employee[];
  /** Сотрудники с активной учётной записью роли ОПР — только они могут быть Оператором (T-070). */
  operatorEmployees: Employee[];
  /** Варианты номера смены с расписанием из Р-05 (T-075). */
  shiftOptions: { value: string; label: string }[];
  /** Дата смены по умолчанию — сегодняшняя. */
  defaultShiftDate: string;
  /** Номер текущей смены по Р-05. */
  defaultShiftNumber: number;
}

interface LineDraft {
  id: string;
  workCenterId: string;
  productId: string;
  plannedQuantity: string;
  operatorId: string;
  workerIds: string[];
}

function makeLineId(): string {
  return 'line_' + Math.random().toString(36).slice(2, 9);
}

function emptyLine(): LineDraft {
  return {
    id: makeLineId(),
    workCenterId: '',
    productId: '',
    plannedQuantity: '',
    operatorId: '',
    workerIds: [],
  };
}

export default function ProductionOrderForm({
  workCenters,
  products,
  workerEmployees,
  operatorEmployees,
  shiftOptions,
  defaultShiftDate,
  defaultShiftNumber,
}: ProductionOrderFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [shiftDate, setShiftDate] = useState(defaultShiftDate);
  const [shiftNumber, setShiftNumber] = useState(String(defaultShiftNumber));
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(id: string) {
    setLines((prev) => prev.filter((line) => line.id !== id));
  }

  function updateLine(id: string, patch: Partial<LineDraft>) {
    setLines((prev) =>
      prev.map((line) => {
        if (line.id !== id) return line;
        const next = { ...line, ...patch };
        // При смене РЦ сбрасываем номенклатуру, чтобы не остался выбор из другой категории.
        if (patch.workCenterId !== undefined && patch.workCenterId !== line.workCenterId) {
          next.productId = '';
        }
        return next;
      }),
    );
  }

  function getFilteredProducts(workCenterId: string): Product[] {
    const workCenter = workCenters.find((wc) => wc.id === workCenterId);
    if (!workCenter) return [];
    return products.filter((product) =>
      workCenter.producesMass ? product.category === 'MASS' : product.category === 'GP',
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const payloadLines: ProductionOrderLineInput[] = lines.map((line) => ({
      workCenterId: line.workCenterId,
      productId: line.productId,
      plannedQuantity: line.plannedQuantity,
      operatorId: line.operatorId,
      workerIds: line.workerIds,
    }));

    const formData = new FormData();
    formData.set('shiftDate', shiftDate);
    formData.set('shiftNumber', shiftNumber);
    formData.set('lines', JSON.stringify(payloadLines));

    startTransition(async () => {
      const result = await createProductionOrderAction(formData);
      if (result.success) {
        router.push('/production-orders');
      } else {
        setError(result.error ?? 'Не удалось создать ПЗ');
      }
    });
  }

  const workCenterOptions = workCenters.map((wc) => ({
    value: wc.id,
    label: wc.code + ' – ' + wc.name + (wc.producesMass ? ' (Масса)' : ' (ГП)') + (wc.active ? '' : ' (деактивирован)'),
  }));

  const workerOptions = buildEmployeeOptions(workerEmployees, [], NOT_WORKER_NOTE);
  const operatorOptions = buildEmployeeOptions(operatorEmployees, [], NOT_OPERATOR_NOTE);

  const canSubmit =
    !isPending &&
    shiftDate !== '' &&
    shiftNumber !== '' &&
    lines.every(
      (line) =>
        line.workCenterId !== '' &&
        line.productId !== '' &&
        line.plannedQuantity.trim() !== '' &&
        line.operatorId !== '',
    );

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-graphite">Создание производственного задания</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="shiftDate">Дата смены</Label>
              <Input
                id="shiftDate"
                type="date"
                value={shiftDate}
                onChange={(e) => setShiftDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="shiftNumber">Смена</Label>
              <Select
                id="shiftNumber"
                value={shiftNumber}
                onChange={(e) => setShiftNumber(e.target.value)}
                options={shiftOptions}
                required
              />
            </div>
          </div>
          <p className="text-sm text-neutral-500">
            Запись смены создаётся автоматически на выбранную дату и номер (Р-05), отдельно её заводить не нужно.
          </p>
        </Card>

        <div className="space-y-4">
          <h2 className="text-lg font-medium text-graphite">Строки ПЗ</h2>
          {lines.map((line, index) => {
            const productOptions = getFilteredProducts(line.workCenterId).map((product) => ({
              value: product.id,
              label: product.code + ' – ' + product.name + ' (' + product.unit + ')',
            }));

            return (
              <Card key={line.id} className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="font-medium text-graphite">РЦ-строка {index + 1}</span>
              {lines.length > 1 && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => removeLine(line.id)}
                >
                  Удалить
                </Button>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={line.id + '_wc'}>Рабочий центр</Label>
                <Select
                  id={line.id + '_wc'}
                  value={line.workCenterId}
                  onChange={(e) =>
                    updateLine(line.id, { workCenterId: e.target.value })
                  }
                  options={workCenterOptions}
                  placeholder="Выберите РЦ"
                  required
                />
                {line.workCenterId && !workCenters.find((wc) => wc.id === line.workCenterId)?.active && (
                  <p className="text-sm text-signal-amber">Этот РЦ деактивирован. Выберите другой.</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor={line.id + '_product'}>Номенклатура</Label>
                <Select
                  id={line.id + '_product'}
                  value={line.productId}
                  onChange={(e) =>
                    updateLine(line.id, { productId: e.target.value })
                  }
                  options={productOptions}
                  placeholder={
                    line.workCenterId
                      ? 'Выберите номенклатуру'
                      : 'Сначала выберите РЦ'
                  }
                  disabled={!line.workCenterId}
                  required
                />
                <p className="text-sm text-neutral-500">
                  {line.workCenterId &&
                    (workCenters.find((wc) => wc.id === line.workCenterId)?.producesMass
                      ? 'Для РЦ 01/02 доступна только номенклатура «Масса»'
                      : 'Для РЦ 03–12 доступна только номенклатура «ГП»')}
                </p>
                {line.productId && !products.find((p) => p.id === line.productId)?.active && (
                  <p className="text-sm text-signal-amber">Эта номенклатура деактивирована. Выберите другую.</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor={line.id + '_qty'}>Плановое количество</Label>
                <Input
                  id={line.id + '_qty'}
                  type="number"
                  min="0.0001"
                  step="0.0001"
                  value={line.plannedQuantity}
                  onChange={(e) =>
                    updateLine(line.id, { plannedQuantity: e.target.value })
                  }
                  placeholder="0.0000"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor={line.id + '_operator'}>Оператор</Label>
                <Select
                  id={line.id + '_operator'}
                  value={line.operatorId}
                  onChange={(e) =>
                    updateLine(line.id, { operatorId: e.target.value })
                  }
                  options={operatorOptions}
                  placeholder="Выберите Оператора"
                  required
                />
                {line.operatorId && !isEligible(line.operatorId, operatorEmployees) && (
                  <p className="text-sm text-signal-amber">
                    У этого сотрудника нет активной учётной записи с ролью ОПР: он не получит уведомление
                    и не сможет внести итог. Выберите другого.
                  </p>
                )}
                {operatorOptions.length === 0 && (
                  <p className="text-sm text-signal-amber">
                    Нет сотрудников с активной учётной записью роли ОПР — назначить Оператора нельзя.
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Работники (необязательно)</Label>
              <CheckboxList
                name={line.id + '_workers'}
                options={workerOptions}
                selected={line.workerIds}
                onChange={(selected) => updateLine(line.id, { workerIds: selected })}
              />
            </div>
          </Card>
            );
          })}

          <Button type="button" variant="secondary" onClick={addLine}>
            + Добавить РЦ
          </Button>
        </div>

        {error && (
          <p className="text-sm text-signal-amber">{error}</p>
        )}

        <div className="flex items-center justify-end gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.push('/production-orders')}
            disabled={isPending}
          >
            Отмена
          </Button>
          <Button type="submit" variant="cta" disabled={!canSubmit}>
            {isPending ? 'Сохранение...' : 'Сохранить черновик'}
          </Button>
        </div>
      </form>
    </div>
  );
}
