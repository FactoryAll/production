'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, Dialog, Input, SearchSelect, Select } from '@prodtrack/ui';
import { formatQuantity } from '@/lib/quantity';
import { filterConsumableForWorkCenter } from '@/lib/consumable-stock';
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
      workerAssignments: Array<{
        employeeId: string;
        employee: { id: string; fullName: string; tabNumber: string };
      }>;
      facts: Array<
        ProductionFact & {
          consumptions: FactConsumption[];
          factWorkers: Array<{
            employeeId: string;
            planned: boolean;
            worked: boolean;
            absenceReasonId: string | null;
            comment: string | null;
            employee: { id: string; fullName: string; tabNumber: string };
          }>;
        }
      >;
    }
  >;
  defectReasons: DefectReason[];
  /** Действующие причины неявки (T-093): нужны, когда работник не вышел. */
  absenceReasons: Array<{ id: string; code: string; name: string }>;
  /** Кого можно добавить в состав, если назначение не совпало с выходом. */
  workerCandidates: Array<{ id: string; fullName: string; tabNumber: string }>;
  /** Позиции, доступные к потреблению: то, что лежит на Производственном складе (Масса или ПФ). */
  consumableProducts: {
    id: string;
    code: string;
    name: string;
    unit: string;
    category: 'MASS' | 'PF' | 'GP';
    available: number;
  }[];
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
  /** Категория остатка, с которой списываем (ОПЭ-34): Масса, ПФ или ГП. */
  stockCategory?: 'MASS' | 'PF' | 'GP';
}

interface BalanceInfo {
  available: number;
  unit: string;
}

/** Строка фактического состава работников в форме итога смены (T-093, §5 постановки). */
interface WorkerRow {
  employeeId: string;
  fullName: string;
  tabNumber: string;
  /** Был ли работник в назначении строки ПЗ — решает сервер, здесь только для подписи. */
  planned: boolean;
  worked: boolean;
  /** Причина неявки из справочника; обязательна, если `worked` снят. */
  absenceReasonId: string;
  /** Словами, почему добавили: обязательно для добавленных работников. */
  comment: string;
}

function emptyReportForm(): {
  quantity: string;
  factCategory: string;
  outputGP: string;
  outputPF: string;
  defectQuantity: string;
  defectReasonId: string;
  stopsCount: string;
  stopsDurationMinutes: string;
  consumption: ConsumptionRow[];
  workers: WorkerRow[];
} {
  return {
    quantity: '',
    factCategory: '',
    outputGP: '',
    outputPF: '',
    defectQuantity: '',
    defectReasonId: '',
    stopsCount: '',
    stopsDurationMinutes: '',
    consumption: [],
    workers: [],
  };
}

export default function ShiftExecutionPage({
  lines,
  employeeId,
  defectReasons,
  consumableProducts,
  absenceReasons,
  workerCandidates,
}: ShiftExecutionPageProps) {
  // ОПЭ-34: список потребления строится на сервере по остаткам Производственного склада
  // (Масса и ПФ). ОПЭ-59: конкретному РЦ доступны не все категории — «Маркировка ЧЗ»
  // (код 13) потребляет только полуфабрикат, поэтому список фильтруется по РЦ строки.
  function consumptionProductsForRow() {
    const code = dialogState?.line.workCenter.code;
    return code ? filterConsumableForWorkCenter(consumableProducts, code) : consumableProducts;
  }
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
  // T-072: диалогу нужны РЦ и номенклатура строки, а не только идентификаторы,
  // поэтому храним строку ПЗ целиком — так, как её отдаёт страница.
  const [dialogState, setDialogState] = useState<{
    line: ShiftExecutionPageProps['lines'][number];
    mode: Exclude<DialogMode, null>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyReportForm());
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof typeof form, string>>>({});
  const [balances, setBalances] = useState<Record<string, BalanceInfo | null>>({});
  const [warnings, setWarnings] = useState<string[] | null>(null);

  function openAcceptDialog(line: ShiftExecutionPageProps['lines'][number]) {
    setDialogState({ line, mode: 'accept' });
    setError(null);
  }

  /**
   * Состав для формы итога (T-093): по умолчанию — назначенные работники, отмеченные вышедшими.
   * Если итог уже вносили, берём прошлый фактический состав, чтобы оператор не подтверждал
   * одно и то же дважды (§5 постановки).
   */
  function buildWorkerRows(line: ShiftExecutionPageProps['lines'][number]): WorkerRow[] {
    const confirmed = new Map<string, WorkerRow>();
    for (const fact of line.facts) {
      for (const row of fact.factWorkers ?? []) {
        confirmed.set(row.employeeId, {
          employeeId: row.employeeId,
          fullName: row.employee.fullName,
          tabNumber: row.employee.tabNumber,
          planned: row.planned,
          worked: row.worked,
          absenceReasonId: row.absenceReasonId ?? '',
          comment: row.comment ?? '',
        });
      }
    }

    const rows: WorkerRow[] = [];
    for (const assignment of line.workerAssignments ?? []) {
      const previous = confirmed.get(assignment.employeeId);
      rows.push(
        previous ?? {
          employeeId: assignment.employeeId,
          fullName: assignment.employee.fullName,
          tabNumber: assignment.employee.tabNumber,
          planned: true,
          worked: true,
          absenceReasonId: '',
          comment: '',
        },
      );
    }
    // Добавленные ранее работники остаются в списке: их не было в назначении.
    for (const row of confirmed.values()) {
      if (!rows.some((item) => item.employeeId === row.employeeId)) {
        rows.push(row);
      }
    }
    return rows;
  }

  function openReportDialog(line: ShiftExecutionPageProps['lines'][number]) {
    setDialogState({ line, mode: 'report' });
    const base = emptyReportForm();
    if (line.product.category === 'MASS') {
      base.factCategory = 'MASS';
    }
    base.workers = buildWorkerRows(line);
    setForm(base);
    setError(null);
    setFieldErrors({});
    setBalances({});
    setWarnings(null);
  }

  function openCorrectDialog(line: ShiftExecutionPageProps['lines'][number]) {
    const facts = line.facts;
    const fact = facts[0];
    setDialogState({ line, mode: 'correct' });
    const base = emptyReportForm();
    if (line.product.category === 'MASS') {
      base.factCategory = 'MASS';
      base.quantity = fact ? String(fact.quantity) : '';
    } else {
      for (const f of facts) {
        if (f.factCategory === 'GP') base.outputGP = String(f.quantity);
        if (f.factCategory === 'PF') base.outputPF = String(f.quantity);
      }
    }
    base.defectQuantity = fact ? String(fact.defectQuantity) : '';
    base.defectReasonId = fact?.defectReasonId ?? '';
    base.stopsCount = fact ? String(fact.stopsCount) : '';
    base.stopsDurationMinutes = fact ? String(fact.stopsDurationMinutes) : '';
    base.consumption =
      fact?.consumptions.map((c) => ({
        productId: c.productId,
        quantity: c.quantity.toString(),
        stockCategory: (c as { stockCategory?: 'MASS' | 'PF' | 'GP' }).stockCategory,
      })) ?? [];
    // Прошлый фактический состав, а если его не было — назначение (T-093, §5 постановки).
    base.workers = buildWorkerRows(line);
    setForm(base);
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
    const category = productCategory();

    if (category === 'MASS') {
      const quantity = Number(form.quantity);
      if (Number.isNaN(quantity) || quantity <= 0) {
        errors.quantity = 'Укажите выпуск';
      }
    } else {
      const gp = Number(form.outputGP);
      const pf = Number(form.outputPF);
      const hasGP = !Number.isNaN(gp) && gp > 0;
      const hasPF = !Number.isNaN(pf) && pf > 0;
      if (!hasGP && !hasPF) {
        errors.outputGP = 'Укажите выпуск ГП или ПФ';
        errors.outputPF = 'Укажите выпуск ГП или ПФ';
      }
      if (!Number.isNaN(gp) && gp < 0) {
        errors.outputGP = 'Количество должно быть неотрицательным';
      }
      if (!Number.isNaN(pf) && pf < 0) {
        errors.outputPF = 'Количество должно быть неотрицательным';
      }
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

    // T-093: любое расхождение с назначением требует причины — иначе сохранение отклоняется
    // и здесь, и на сервере (`resolveWorkerComposition`).
    if (form.workers.some((row) => !row.worked && !row.absenceReasonId)) {
      errors.workers = 'Укажите причину неявки для каждого, кто не вышел';
    } else if (form.workers.some((row) => !row.planned && !row.comment.trim())) {
      errors.workers = 'Укажите причину, по которой работника добавили в состав';
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

  function updateWorkerRow(employeeId: string, patch: Partial<WorkerRow>) {
    setForm((f) => ({
      ...f,
      workers: f.workers.map((row) => (row.employeeId === employeeId ? { ...row, ...patch } : row)),
    }));
  }

  function removeWorkerRow(employeeId: string) {
    setForm((f) => ({ ...f, workers: f.workers.filter((row) => row.employeeId !== employeeId) }));
  }

  function addWorkerRow(employeeId: string) {
    const candidate = workerCandidates.find((item) => item.id === employeeId);
    if (!candidate) return;
    setForm((f) => {
      if (f.workers.some((row) => row.employeeId === employeeId)) {
        return f;
      }
      return {
        ...f,
        workers: [
          ...f.workers,
          {
            employeeId: candidate.id,
            fullName: candidate.fullName,
            tabNumber: candidate.tabNumber,
            planned: false,
            worked: true,
            absenceReasonId: '',
            comment: '',
          },
        ],
      };
    });
  }

  function handleReport() {
    if (!dialogState) return;
    if (!validateReportForm()) return;
    startTransition(async () => {
      const formData = new FormData();
      if (productCategory() === 'MASS') {
        formData.set('quantity', form.quantity);
        formData.set('factCategory', form.factCategory);
      } else {
        const outputByCategory: Record<string, number> = {};
        const gp = Number(form.outputGP);
        const pf = Number(form.outputPF);
        if (!Number.isNaN(gp) && gp > 0) outputByCategory.GP = gp;
        if (!Number.isNaN(pf) && pf > 0) outputByCategory.PF = pf;
        formData.set('outputByCategory', JSON.stringify(outputByCategory));
      }
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
              .map((row) => ({
                productId: row.productId,
                quantity: Number(row.quantity),
                stockCategory: row.stockCategory,
              })),
          ),
        );
      }

      // Состав уходит снимком: сервер сам проставит признак «назначен» по строке ПЗ.
      formData.set(
        'workers',
        JSON.stringify(
          form.workers.map((row) => ({
            employeeId: row.employeeId,
            worked: row.worked,
            absenceReasonId: row.worked ? null : row.absenceReasonId || null,
            comment: row.comment.trim() || null,
          })),
        ),
      );

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
      if (productCategory() === 'MASS') {
        formData.set('quantity', form.quantity);
        formData.set('factCategory', form.factCategory);
      } else {
        const outputByCategory: Record<string, number> = {};
        const gp = Number(form.outputGP);
        const pf = Number(form.outputPF);
        if (!Number.isNaN(gp) && gp > 0) outputByCategory.GP = gp;
        if (!Number.isNaN(pf) && pf > 0) outputByCategory.PF = pf;
        formData.set('outputByCategory', JSON.stringify(outputByCategory));
      }
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
              .map((row) => ({
                productId: row.productId,
                quantity: Number(row.quantity),
                stockCategory: row.stockCategory,
              })),
          ),
        );
      }

            // Состав уходит снимком: сервер сам проставит признак «назначен» по строке ПЗ.
      formData.set(
        'workers',
        JSON.stringify(
          form.workers.map((row) => ({
            employeeId: row.employeeId,
            worked: row.worked,
            absenceReasonId: row.worked ? null : row.absenceReasonId || null,
            comment: row.comment.trim() || null,
          })),
        ),
      );

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
            <strong>
              {dialogState?.line.workCenter.code} — {dialogState?.line.workCenter.name}
            </strong>
            ?
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
        // ОПЭ-37: модалка шире — в узкой не читались наименование номенклатуры и количество.
        size="lg"
        title={dialogState?.mode === 'correct' ? 'Корректировать факт' : 'Внести итог смены'}
      >
        <div className="space-y-4">
          <p className="text-graphite">
            ПЗ по РЦ{' '}
            <strong>
              {dialogState?.line.workCenter.code} — {dialogState?.line.workCenter.name}
            </strong>
          </p>
          <p className="text-graphite">
            Продукция строки:{' '}
            <strong>
              {dialogState?.line.product.code} — {dialogState?.line.product.name} (
              {dialogState?.line.product.unit})
            </strong>
          </p>
          <div className="space-y-3">
            {productCategory() === 'MASS' ? (
              <div>
                <label className="mb-1 block text-sm text-graphite">Выпуск, кг</label>
                <Input
                  type="number"
                  min={0}
                  step="1"
                  value={form.quantity}
                  onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                />
                {fieldErrors.quantity && <p className="text-sm text-signal-amber">{fieldErrors.quantity}</p>}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm text-graphite">Выпуск ГП, шт</label>
                  <Input
                    type="number"
                    min={0}
                    step="1"
                    value={form.outputGP}
                    onChange={(e) => setForm((f) => ({ ...f, outputGP: e.target.value }))}
                  />
                  {fieldErrors.outputGP && <p className="text-sm text-signal-amber">{fieldErrors.outputGP}</p>}
                </div>
                <div>
                  <label className="mb-1 block text-sm text-graphite">Выпуск ПФ, шт</label>
                  <Input
                    type="number"
                    min={0}
                    step="1"
                    value={form.outputPF}
                    onChange={(e) => setForm((f) => ({ ...f, outputPF: e.target.value }))}
                  />
                  {fieldErrors.outputPF && <p className="text-sm text-signal-amber">{fieldErrors.outputPF}</p>}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm text-graphite">Брак</label>
                <Input
                  type="number"
                  min={0}
                  step="1"
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
                  const rowProducts = consumptionProductsForRow();
                  const selectedProduct = rowProducts.find(
                    (p) => p.id === row.productId && (!row.stockCategory || p.category === row.stockCategory),
                  );
                  const balance = row.productId ? balances[row.productId] : null;
                  const quantityNum = Number(row.quantity);
                  const showWarning = balance && !Number.isNaN(quantityNum) && quantityNum > balance.available && balance.available >= 0;
                  return (
                    <div key={index} className="mb-3 grid grid-cols-[1fr_1fr_auto] gap-2">
                      {/* Потребление выбирается с поиском: номенклатуры сотни (фидбэк ОПЭ). */}
                      <SearchSelect
                        options={rowProducts.map((p) => ({
                          // ОПЭ-34: одна номенклатура может лежать двумя остатками (Масса и ПФ),
                          // поэтому вариант — пара «продукт + категория остатка».
                          value: `${p.id}|${p.category}`,
                          label: `${p.name} (${p.unit})${p.category === 'PF' ? ' — ПФ' : ''}`,
                          keywords: p.code,
                        }))}
                        placeholder="Начните вводить наименование"
                        value={row.stockCategory ? `${row.productId}|${row.stockCategory}` : row.productId}
                        onChange={(value) => {
                          const [productId, stockCategory] = value.split('|');
                          updateConsumptionRow(index, {
                            productId,
                            stockCategory: stockCategory as ConsumptionRow['stockCategory'],
                          });
                        }}
                      />
                      <Input
                        type="number"
                        min={0}
                        step="1"
                        placeholder={
                          selectedProduct
                            ? `Доступно: ${formatQuantity(selectedProduct.available)} ${selectedProduct.unit}`
                            : 'Количество'
                        }
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
                          Превышение остатка на {formatQuantity(quantityNum - balance!.available)} {balance!.unit}; будет записано с предупреждением
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

          {(dialogState?.mode === 'report' || dialogState?.mode === 'correct') && (
            <div className="space-y-3 rounded-md border border-mist-metal p-3">
              <p className="text-sm font-medium text-graphite">
                Работники смены
                {(dialogState.line.workerAssignments ?? []).length > 0
                  ? ' — назначенные отмечены; снимите отметку у тех, кто не выходил'
                  : ' — в строке ПЗ работники не назначались, состав можно указать здесь'}
              </p>

              {form.workers.length === 0 && (
                <p className="text-sm text-steel-graphite">
                  Состав пуст: работники на эту строку не назначались.
                </p>
              )}

              {form.workers.map((row) => (
                <div key={row.employeeId} className="grid grid-cols-12 items-start gap-2">
                  <label className="col-span-6 flex items-center gap-2 text-sm text-graphite">
                    <input
                      type="checkbox"
                      checked={row.worked}
                      disabled={isPending}
                      onChange={(e) =>
                        updateWorkerRow(row.employeeId, {
                          worked: e.target.checked,
                          // Отметку вернули — причина неявки больше не нужна.
                          absenceReasonId: e.target.checked ? '' : row.absenceReasonId,
                        })
                      }
                    />
                    <span>
                      {row.fullName}
                      <span className="text-steel-graphite"> · {row.tabNumber}</span>
                      {!row.planned && <span className="text-steel-graphite"> (добавлен)</span>}
                    </span>
                  </label>

                  {!row.worked && (
                    <div className="col-span-5">
                      <select
                        aria-label={'Причина неявки: ' + row.fullName}
                        className="h-10 w-full rounded-md border border-mist-metal bg-white px-3 text-base text-graphite"
                        value={row.absenceReasonId}
                        disabled={isPending}
                        onChange={(e) =>
                          updateWorkerRow(row.employeeId, { absenceReasonId: e.target.value })
                        }
                      >
                        <option value="">Причина неявки…</option>
                        {absenceReasons.map((reason) => (
                          <option key={reason.id} value={reason.id}>
                            {reason.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {!row.planned && (
                    <div className="col-span-5">
                      <Input
                        placeholder="Почему добавили (обязательно)"
                        value={row.comment}
                        disabled={isPending}
                        onChange={(e) =>
                          updateWorkerRow(row.employeeId, { comment: e.target.value })
                        }
                      />
                    </div>
                  )}

                  {!row.planned && (
                    <div className="col-span-1">
                      <Button
                        variant="secondary"
                        type="button"
                        disabled={isPending}
                        onClick={() => removeWorkerRow(row.employeeId)}
                      >
                        ×
                      </Button>
                    </div>
                  )}
                </div>
              ))}

              <div className="grid grid-cols-12 items-center gap-2">
                <div className="col-span-6">
                  <select
                    aria-label="Добавить работника"
                    className="h-10 w-full rounded-md border border-mist-metal bg-white px-3 text-base text-graphite"
                    value=""
                    disabled={isPending}
                    onChange={(e) => {
                      if (e.target.value) addWorkerRow(e.target.value);
                    }}
                  >
                    <option value="">Добавить работника, которого не назначали…</option>
                    {workerCandidates
                      .filter((item) => !form.workers.some((row) => row.employeeId === item.id))
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.fullName} · {item.tabNumber}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              {fieldErrors.workers && (
                <p className="text-sm text-signal-amber">{fieldErrors.workers}</p>
              )}
            </div>
          )}

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
