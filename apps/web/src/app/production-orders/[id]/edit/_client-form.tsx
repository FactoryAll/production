'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, Select, Input, Label, CheckboxList, Card } from '@prodtrack/ui';
import { updateProductionOrderAction } from '../../actions';
import type { ProductionOrderLineInput } from '@/lib/validation/production-order';
import type {
  ProductionOrder,
  ProductionOrderLine,
  Shift,
  WorkCenter,
  Product,
  Employee,
} from '@prisma/client';

interface ProductionOrderEditFormProps {
  order: ProductionOrder & {
    shift: Shift;
    lines: Array<
      ProductionOrderLine & {
        workCenter: WorkCenter;
        product: Product;
        operator: Employee | null;
        workerAssignments: Array<{ employee: Employee }>;
      }
    >;
  };
  shifts: Shift[];
  workCenters: WorkCenter[];
  products: Product[];
  employees: Employee[];
}

function formatShift(shift: Shift): string {
  const date = new Date(shift.date).toLocaleDateString('ru-RU');
  return 'Смена ' + shift.number + ' (' + date + ', ' + shift.start + '–' + shift.end + ')';
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

function lineToDraft(line: ProductionOrderEditFormProps['order']['lines'][number]): LineDraft {
  return {
    id: line.id,
    workCenterId: line.workCenterId,
    productId: line.productId,
    plannedQuantity: line.plannedQuantity.toString(),
    operatorId: line.operatorId ?? '',
    workerIds: line.workerAssignments.map((wa) => wa.employee.id),
  };
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

export default function ProductionOrderEditForm({
  order,
  shifts,
  workCenters,
  products,
  employees,
}: ProductionOrderEditFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [shiftId, setShiftId] = useState(order.shiftId);
  const [lines, setLines] = useState<LineDraft[]>(order.lines.map(lineToDraft));
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
    formData.set('shiftId', shiftId);
    formData.set('lines', JSON.stringify(payloadLines));

    startTransition(async () => {
      const result = await updateProductionOrderAction(order.id, formData);
      if (result.success) {
        router.push('/production-orders/' + order.id);
      } else {
        setError(result.error ?? 'Не удалось изменить ПЗ');
      }
    });
  }

  const shiftOptions = shifts.map((shift) => ({
    value: shift.id,
    label: formatShift(shift) + (shift.active ? '' : ' (деактивирована)'),
  }));

  const workCenterOptions = workCenters.map((wc) => ({
    value: wc.id,
    label: wc.code + ' – ' + wc.name + (wc.producesMass ? ' (Масса)' : ' (ГП)') + (wc.active ? '' : ' (деактивирован)'),
  }));

  const employeeOptions = employees.map((emp) => ({
    value: emp.id,
    label: emp.fullName + (emp.active ? '' : ' (деактивирован)'),
  }));

  const canSubmit =
    !isPending &&
    shiftId !== '' &&
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
        <div className="space-y-1">
          <Link href={'/production-orders/' + order.id} className="text-sm text-neutral-500 hover:text-graphite">
            ← К карточке ПЗ
          </Link>
          <h1 className="text-2xl font-semibold text-graphite">Редактирование ПЗ {order.id.slice(0, 8)}</h1>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="shift">Смена</Label>
            <Select
              id="shift"
              value={shiftId}
              onChange={(e) => setShiftId(e.target.value)}
              options={shiftOptions}
              placeholder="Выберите смену"
              required
            />
            {shiftId && !shifts.find((s) => s.id === shiftId)?.active && (
              <p className="text-sm text-signal-amber">Эта смена деактивирована. Выберите другую.</p>
            )}
          </div>
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
                      onChange={(e) => updateLine(line.id, { workCenterId: e.target.value })}
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
                      onChange={(e) => updateLine(line.id, { productId: e.target.value })}
                      options={productOptions}
                      placeholder={line.workCenterId ? 'Выберите номенклатуру' : 'Сначала выберите РЦ'}
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
                      onChange={(e) => updateLine(line.id, { plannedQuantity: e.target.value })}
                      placeholder="0.0000"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={line.id + '_operator'}>Оператор</Label>
                    <Select
                      id={line.id + '_operator'}
                      value={line.operatorId}
                      onChange={(e) => updateLine(line.id, { operatorId: e.target.value })}
                      options={employeeOptions}
                      placeholder="Выберите Оператора"
                      required
                    />
                    {line.operatorId && !employees.find((emp) => emp.id === line.operatorId)?.active && (
                      <p className="text-sm text-signal-amber">Этот сотрудник деактивирован. Выберите другого.</p>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Работники (необязательно)</Label>
                  <CheckboxList
                    name={line.id + '_workers'}
                    options={employeeOptions}
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

        {error && <p className="text-sm text-signal-amber">{error}</p>}

        <div className="flex items-center justify-end gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.push('/production-orders/' + order.id)}
            disabled={isPending}
          >
            Отмена
          </Button>
          <Button type="submit" variant="cta" disabled={!canSubmit}>
            {isPending ? 'Сохранение...' : 'Сохранить изменения'}
          </Button>
        </div>
      </form>
    </div>
  );
}
