'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Card, Dialog, SearchSelect, Select, Label } from '@prodtrack/ui';
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
  FactConsumption,
  DefectReason,
} from '@prisma/client';
import { confirmProductionOrderAction, substituteOperatorAction, cancelProductionOrderAction, correctProductionFactAction } from '../actions';
import { factCategoryLabel } from '@/lib/onec/labels';
import { filterConsumableForWorkCenter } from '@/lib/consumable-stock';

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
        facts: Array<
          ProductionFact & {
            defectReason: DefectReason | null;
            // T-073: состав потребления нужен, чтобы корректировать его в карточке,
            // а номенклатура — чтобы показать, что и сколько потреблялось (Р-10).
            consumptions: Array<FactConsumption & { product: Product }>;
            // T-093: фактический состав работников — прошлый снимок для формы.
            factWorkers: Array<{
              employeeId: string;
              planned: boolean;
              worked: boolean;
              absenceReasonId: string | null;
              comment: string | null;
              employee: Pick<Employee, 'id' | 'fullName' | 'tabNumber'>;
            }>;
          }
        >;
        workerAssignments: Array<ProductionOrderLineWorkers & { employee: Employee }>;
        /** Привязанные перемещения (T-103): карточка показывает, что перемещение уже создано. */
        transferLines: Array<{
          id: string;
          goodsTransferId: string;
          goodsTransfer: { status: string };
        }>;
      }
    >;
  };
  defectReasons: DefectReason[];
  /**
   * Позиции, доступные к потреблению (ОПЭ-44): то, что лежит на Производственном складе
   * (Масса или ПФ), с доступным количеством. Тот же набор, что на экране исполнения смены.
   */
  consumableProducts: {
    id: string;
    code: string;
    name: string;
    unit: string;
    category: 'MASS' | 'PF' | 'GP';
    available: number;
  }[];
  /** Действующие причины неявки (T-093): нужны, когда работник не вышел. */
  absenceReasons: Array<{ id: string; code: string; name: string }>;
  /** Кого можно добавить в состав, если назначение не совпало с выходом. */
  workerCandidates: Array<{ id: string; fullName: string; tabNumber: string }>;
  /** Склады для кнопки «Создать перемещение» (T-103): производственный и склад ГП. */
  transferWarehouses: Array<{ id: string; type: 'PRODUCTION' | 'FINISHED_GOODS' }>;
  userRoles: string[];
}

interface ConsumptionRowState {
  productId: string;
  quantity: string;
  /** Категория остатка, с которой списываем (ОПЭ-34/44). */
  stockCategory?: 'MASS' | 'PF' | 'GP';
}

/**
 * Редактор потребления (Р-10): строки «номенклатура + количество» с добавлением и удалением.
 * Используется и в «Вводе за Оператора» (Р-11), и в «Корректировке факта» (Р-18, T-073).
 */
function ConsumptionEditor({
  idPrefix,
  rows,
  products,
  onChange,
}: {
  idPrefix: string;
  rows: ConsumptionRowState[];
  products: {
    id: string;
    code: string;
    name: string;
    unit: string;
    category: 'MASS' | 'PF' | 'GP';
    available: number;
  }[];
  onChange: (rows: ConsumptionRowState[]) => void;
}) {
  const options = products.map((product) => ({
    // ОПЭ-44: одна номенклатура может лежать двумя остатками (Масса и ПФ) — вариант из пары.
    value: `${product.id}|${product.category}`,
    label: `${product.name} (${product.unit})${product.category === 'PF' ? ' — ПФ' : ''}`,
    // В подписи кода нет, но искать по нему нужно.
    keywords: product.code,
  }));

  return (
    <div className="space-y-2">
      <Label htmlFor={`${idPrefix}-consumption-0`}>Потребление</Label>
      {rows.map((row, index) => (
        <div key={index} className="flex items-end gap-2">
          <div className="flex-1">
            <SearchSelect
              id={`${idPrefix}-consumption-${index}`}
              value={row.stockCategory ? `${row.productId}|${row.stockCategory}` : row.productId}
              onChange={(value) => {
                const [productId, stockCategory] = value.split('|');
                onChange(
                  rows.map((item, i) =>
                    i === index
                      ? { ...item, productId, stockCategory: stockCategory as ConsumptionRowState['stockCategory'] }
                      : item,
                  ),
                );
              }}
              options={options}
              placeholder="Начните вводить наименование"
            />
          </div>
          <input
            type="number"
            min="0"
            step="1"
            value={row.quantity}
            onChange={(e) =>
              onChange(rows.map((item, i) => (i === index ? { ...item, quantity: e.target.value } : item)))
            }
            placeholder="Количество"
            aria-label="Количество потребления"
            className="h-10 w-32 rounded-md border border-mist-metal bg-white px-3 py-2 text-base text-graphite placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-deep-industry-blue"
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
            aria-label="Удалить строку потребления"
          >
            ×
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        onClick={() => onChange([...rows, { productId: '', quantity: '' }])}
      >
        Добавить строку потребления
      </Button>
    </div>
  );
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

/**
 * Строка фактического состава работников в формах «Ввод за Оператора» и «Корректировать факт»
 * (T-093). Одна форма на два диалога: правила одинаковые, экраны повторяют друг друга.
 */
interface CardWorkerRow {
  employeeId: string;
  fullName: string;
  tabNumber: string;
  planned: boolean;
  worked: boolean;
  absenceReasonId: string;
  comment: string;
}

const TRANSFER_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'черновик',
  SUBMITTED: 'отправлено',
  RECEIVED: 'принято',
  DISCREPANCY: 'расхождение',
  RECONCILED: 'согласовано',
  CANCELLED: 'отменено',
};

const SUBSTITUTION_REASON_OPTIONS = [
  { value: 'ILLNESS', label: 'Болезнь' },
  { value: 'NO_SHOW', label: 'Неявка' },
  { value: 'LEFT_SHIFT', label: 'Ушёл во время смены' },
  { value: 'OTHER', label: 'Прочее' },
];

/**
 * Редактор фактического состава работников (T-093). Показывает назначенных отмеченными,
 * снимает отметку только с причиной из справочника, добавленного требует с причиной словами.
 * Тот же вид, что у оператора на экране исполнения смены.
 */
function WorkerCompositionEditor({
  rows,
  absenceReasons,
  workerCandidates,
  disabled,
  onChange,
}: {
  rows: CardWorkerRow[];
  absenceReasons: Array<{ id: string; code: string; name: string }>;
  workerCandidates: Array<{ id: string; fullName: string; tabNumber: string }>;
  disabled: boolean;
  onChange: (rows: CardWorkerRow[]) => void;
}) {
  function patch(employeeId: string, changes: Partial<CardWorkerRow>) {
    onChange(rows.map((row) => (row.employeeId === employeeId ? { ...row, ...changes } : row)));
  }

  function remove(employeeId: string) {
    onChange(rows.filter((row) => row.employeeId !== employeeId));
  }

  function add(employeeId: string) {
    const candidate = workerCandidates.find((item) => item.id === employeeId);
    if (!candidate || rows.some((row) => row.employeeId === employeeId)) return;
    onChange([
      ...rows,
      {
        employeeId: candidate.id,
        fullName: candidate.fullName,
        tabNumber: candidate.tabNumber,
        planned: false,
        worked: true,
        absenceReasonId: '',
        comment: '',
      },
    ]);
  }

  return (
    <div className="space-y-3 rounded-md border border-mist-metal p-3">
      <p className="text-sm font-medium text-graphite">
        Работники смены — назначенные отмечены; снимите отметку у тех, кто не выходил
      </p>

      {rows.length === 0 && (
        <p className="text-sm text-steel-graphite">
          Состав пуст: работники на эту строку не назначались.
        </p>
      )}

      {rows.map((row) => (
        <div key={row.employeeId} className="grid grid-cols-12 items-start gap-2">
          <label className="col-span-6 flex items-center gap-2 text-sm text-graphite">
            <input
              type="checkbox"
              checked={row.worked}
              disabled={disabled}
              onChange={(e) =>
                patch(row.employeeId, {
                  worked: e.target.checked,
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
                disabled={disabled}
                onChange={(e) => patch(row.employeeId, { absenceReasonId: e.target.value })}
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
              <input
                aria-label={'Почему добавили: ' + row.fullName}
                placeholder="Почему добавили (обязательно)"
                value={row.comment}
                disabled={disabled}
                onChange={(e) => patch(row.employeeId, { comment: e.target.value })}
                className="flex h-10 w-full rounded-md border border-mist-metal bg-white px-3 py-2 text-base text-graphite placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-deep-industry-blue"
              />
            </div>
          )}

          {!row.planned && (
            <div className="col-span-1">
              <Button variant="secondary" type="button" disabled={disabled} onClick={() => remove(row.employeeId)}>
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
            disabled={disabled}
            onChange={(e) => {
              if (e.target.value) add(e.target.value);
            }}
          >
            <option value="">Добавить работника, которого не назначали…</option>
            {workerCandidates
              .filter((item) => !rows.some((row) => row.employeeId === item.id))
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.fullName} · {item.tabNumber}
                </option>
              ))}
          </select>
        </div>
      </div>
    </div>
  );
}

export default function ProductionOrderCard({
  order,
  defectReasons,
  consumableProducts,
  absenceReasons,
  workerCandidates,
  transferWarehouses,
  userRoles,
}: ProductionOrderCardProps) {
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
  const [substituteOutput, setSubstituteOutput] = useState('');
  const [substituteOutputPF, setSubstituteOutputPF] = useState('');
  const [substituteDefectQuantity, setSubstituteDefectQuantity] = useState('');
  const [substituteDefectReasonId, setSubstituteDefectReasonId] = useState('');
  const [substituteStopsCount, setSubstituteStopsCount] = useState('');
  const [substituteStopsDurationMinutes, setSubstituteStopsDurationMinutes] = useState('');
  const [substituteError, setSubstituteError] = useState<string | null>(null);
  const [showCorrectFactDialog, setShowCorrectFactDialog] = useState(false);
  const [correctFactId, setCorrectFactId] = useState<string | null>(null);
  /** Категория правимого факта (ГП, ПФ, Масса) — её видно и в кнопке, и в модалке (ОПЭ-57). */
  const [correctFactCategory, setCorrectFactCategory] = useState<'MASS' | 'GP' | 'PF' | null>(null);
  const [correctQuantity, setCorrectQuantity] = useState('');
  const [correctDefectQuantity, setCorrectDefectQuantity] = useState('');
  const [correctDefectReasonId, setCorrectDefectReasonId] = useState('');
  const [correctStops, setCorrectStops] = useState('');
  const [correctReason, setCorrectReason] = useState('');
  const [correctConsumption, setCorrectConsumption] = useState<ConsumptionRowState[]>([]);
  const [correctLineId, setCorrectLineId] = useState<string | null>(null);
  const [correctError, setCorrectError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const isDraft = order.status === 'DRAFT';
  const canConfirm = isDraft && hasPermission(userRoles, 'production_order:confirm');
  const editableStatuses: ProductionOrderStatus[] = ['DRAFT', 'CONFIRMED', 'IN_PROGRESS'];
  const hasReportedLine = order.lines.some((line) => line.status === 'REPORTED');
  const isCompleted = order.status === 'COMPLETED';
  const isInProgress = order.status === 'IN_PROGRESS';
  const isCancelled = order.status === 'CANCELLED';
  const canEdit =
    editableStatuses.includes(order.status) && !hasReportedLine && hasPermission(userRoles, 'production_order:update');
  const canSubstitute = hasPermission(userRoles, 'production_order:confirm') && !isDraft && !isCancelled;
  const canCorrectFact = isCompleted && hasPermission(userRoles, 'production_order:confirm');
  // Перемещение ГП из строки ПЗ (T-103): только тому, кто вправе его создать.
  const canCreateTransfer = hasPermission(userRoles, 'transfer:create');

  /** Факт ГП по строке — количество для предзаполнения перемещения (T-103). */
  function gpFactOfLine(line: { facts: Array<{ factCategory: string; quantity: { toString(): string } }> }): string {
    const total = line.facts
      .filter((fact) => fact.factCategory === 'GP')
      .reduce((sum, fact) => sum + Number(fact.quantity.toString()), 0);
    return total > 0 ? String(total) : '';
  }

  /**
   * Ссылка «Создать перемещение» из строки ПЗ: номенклатура строки, количество — **факт ГП**
   * (а не план), строка ПЗ и склады по умолчанию (Производственный → Склад ГП).
   */
  function transferCreateHref(line: ProductionOrderLine): string {
    const production = transferWarehouses.find((warehouse) => warehouse.type === 'PRODUCTION');
    const finishedGoods = transferWarehouses.find((warehouse) => warehouse.type === 'FINISHED_GOODS');
    const quantity = gpFactOfLine(line as unknown as { facts: Array<{ factCategory: string; quantity: { toString(): string } }> });
    const params = new URLSearchParams({ productId: line.productId, productionOrderLineId: line.id });
    if (quantity) {
      params.set('quantity', quantity);
    }
    if (production) {
      params.set('sourceWarehouseId', production.id);
    }
    if (finishedGoods) {
      params.set('destinationWarehouseId', finishedGoods.id);
    }
    return `/transfers/new?${params.toString()}`;
  }
  const canViewShiftReport = isCompleted && hasPermission(userRoles, 'production_order:read');
  const canCancel =
    (order.status === 'DRAFT' || order.status === 'CONFIRMED') &&
    !hasReportedLine &&
    hasPermission(userRoles, 'production_order:confirm');
  const reportedCount = order.lines.filter((line) => line.status === 'REPORTED').length;
  const totalCount = order.lines.length;

  function handleConfirm() {
    setConfirmError(null);
    startTransition(async () => {
      const result = await confirmProductionOrderAction(order.id);
      if (result.success) {
        setShowConfirmDialog(false);
        router.refresh();
      } else {
        // Диалог остаётся открытым, иначе сообщение об ошибке не увидеть (T-065).
        setConfirmError(result.error ?? 'Не удалось подтвердить ПЗ');
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

  function openCorrectFactDialog(
    fact: ProductionFact & { consumptions: FactConsumption[] },
    lineId: string,
  ) {
    setCorrectFactId(fact.id);
    setCorrectFactCategory(fact.factCategory as 'MASS' | 'GP' | 'PF');
    setCorrectLineId(lineId);
    setCorrectQuantity(fact.quantity.toString());
    setCorrectDefectQuantity(fact.defectQuantity.toString());
    setCorrectDefectReasonId(fact.defectReasonId ?? '');
    setCorrectStops(fact.stopsDurationMinutes.toString());
    // T-073: потребление правится вместе с остальным фактом — показываем текущий состав.
    setCorrectConsumption(
      fact.consumptions.map((item) => ({
        productId: item.productId,
        quantity: item.quantity.toString(),
      })),
    );
    // T-093: прошлый фактический состав строки — основа для подтверждения состава.
    setCorrectWorkers(buildCardWorkerRows(lineId));
    setCorrectReason('');
    setCorrectError(null);
    setShowCorrectFactDialog(true);
  }

  /** РЦ строки, факт которой корректируется: на МАСС-РЦ потребление не указывается (Р-10). */
  /** Потребление для строки с учётом правил её РЦ (ОПЭ-59: «Маркировка ЧЗ» — только ПФ). */
  function consumableForLine(lineId: string | null) {
    const line = lineId ? order.lines.find((item) => item.id === lineId) : undefined;
    return line
      ? filterConsumableForWorkCenter(consumableProducts, line.workCenter.code)
      : consumableProducts;
  }

  function correctLineProducesMass(): boolean {
    if (!correctLineId) return true;
    const line = order.lines.find((item) => item.id === correctLineId);
    return line?.workCenter.producesMass ?? true;
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
    const workersError = validateWorkers(correctWorkers);
    if (workersError) {
      setCorrectError(workersError);
      return;
    }

    const consumption = correctConsumption.filter((row) => row.productId && row.quantity);
    const seenProducts = new Set<string>();
    for (const row of consumption) {
      if (seenProducts.has(row.productId)) {
        setCorrectError('Позиция потребления не может повторяться');
        return;
      }
      seenProducts.add(row.productId);
      if (Number(row.quantity) <= 0 || Number.isNaN(Number(row.quantity))) {
        setCorrectError('Количество потребления должно быть больше 0');
        return;
      }
    }

    const formData = new FormData();
    formData.set('quantity', correctQuantity);
    if (correctDefectQuantity) formData.set('defectQuantity', correctDefectQuantity);
    if (correctDefectReasonId) formData.set('defectReasonId', correctDefectReasonId);
    if (correctStops) formData.set('stopsDurationMinutes', correctStops);
    // Поле передаётся всегда: пустой список означает «потребления у факта нет» (T-073).
    formData.set(
      'consumption',
      JSON.stringify(
        consumption.map((row) => ({
          productId: row.productId,
          quantity: Number(row.quantity),
          // ОПЭ-34/44: списание идёт с выбранной категории остатка (Масса или ПФ).
          stockCategory: row.stockCategory,
        })),
      ),
    );
    formData.set('correctionReason', reason);
    formData.set('workers', workersPayload(correctWorkers));

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

  const [substituteConsumption, setSubstituteConsumption] = useState<{ productId: string; quantity: string }[]>([]);
  // T-093: фактический состав работников в обоих диалогах карточки.
  const [substituteWorkers, setSubstituteWorkers] = useState<CardWorkerRow[]>([]);
  const [correctWorkers, setCorrectWorkers] = useState<CardWorkerRow[]>([]);

  /**
   * Состав для формы: прошлый факт линии, если он есть, иначе назначение (T-093).
   * Прошлый состав важнее: причина неявки у этих работников уже записана, и повторять её
   * при «Вводе за Оператора» и корректировке не нужно.
   */
  function buildCardWorkerRows(lineId: string): CardWorkerRow[] {
    const line = order.lines.find((item) => item.id === lineId);
    if (!line) {
      return [];
    }
    const confirmed = new Map<string, CardWorkerRow>();
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

    const rows: CardWorkerRow[] = [];
    for (const assignment of line.workerAssignments ?? []) {
      const previous = confirmed.get(assignment.employee.id);
      rows.push(
        previous ?? {
          employeeId: assignment.employee.id,
          fullName: assignment.employee.fullName,
          tabNumber: assignment.employee.tabNumber,
          planned: true,
          worked: true,
          absenceReasonId: '',
          comment: '',
        },
      );
    }
    // Добавленные ранее работники остаются: их не было в назначении.
    for (const row of confirmed.values()) {
      if (!rows.some((item) => item.employeeId === row.employeeId)) {
        rows.push(row);
      }
    }
    return rows;
  }

  /** Правила те же, что на сервере: причина обязательна при любом расхождении. */
  function validateWorkers(rows: CardWorkerRow[]): string | null {
    if (rows.some((row) => !row.worked && !row.absenceReasonId)) {
      return 'Укажите причину неявки для каждого, кто не вышел';
    }
    if (rows.some((row) => !row.planned && !row.comment.trim())) {
      return 'Укажите причину, по которой работника добавили в состав';
    }
    return null;
  }

  function workersPayload(rows: CardWorkerRow[]): string {
    return JSON.stringify(
      rows.map((row) => ({
        employeeId: row.employeeId,
        worked: row.worked,
        absenceReasonId: row.worked ? null : row.absenceReasonId || null,
        comment: row.comment.trim() || null,
      })),
    );
  }

  function openSubstituteDialog(lineId: string) {
    setSubstituteLineId(lineId);
    setSubstituteReason('');
    setSubstituteComment('');
    setSubstituteOutput('');
    setSubstituteOutputPF('');
    setSubstituteDefectQuantity('');
    setSubstituteDefectReasonId('');
    setSubstituteStopsCount('');
    setSubstituteStopsDurationMinutes('');
    setSubstituteConsumption([]);
    setSubstituteWorkers(buildCardWorkerRows(lineId));
    setSubstituteError(null);
    setShowSubstituteDialog(true);
  }

  function productCategoryForSubstituteLine(): 'MASS' | 'GP' {
    if (!substituteLineId) return 'MASS';
    const line = order.lines.find((l) => l.id === substituteLineId);
    return line?.product.category === 'MASS' ? 'MASS' : 'GP';
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
    const workersError = validateWorkers(substituteWorkers);
    if (workersError) {
      setSubstituteError(workersError);
      return;
    }

    const category = productCategoryForSubstituteLine();
    const formData = new FormData();
    formData.set('reasonCode', substituteReason);
    formData.set('comment', substituteComment.trim());

    if (category === 'MASS') {
      formData.set('output', substituteOutput);
      formData.set('factCategory', 'MASS');
    } else {
      const outputByCategory: Record<string, number> = {};
      const gp = Number(substituteOutput);
      const pf = Number(substituteOutputPF);
      if (!Number.isNaN(gp) && gp > 0) outputByCategory.GP = gp;
      if (!Number.isNaN(pf) && pf > 0) outputByCategory.PF = pf;
      if (Object.keys(outputByCategory).length === 0) {
        setSubstituteError('Укажите выпуск ГП или ПФ');
        return;
      }
      formData.set('outputByCategory', JSON.stringify(outputByCategory));
    }

    if (substituteDefectQuantity) formData.set('defectQuantity', substituteDefectQuantity);
    if (substituteDefectReasonId) formData.set('defectReasonId', substituteDefectReasonId);
    if (substituteStopsCount) formData.set('stopsCount', substituteStopsCount);
    if (substituteStopsDurationMinutes) formData.set('stopsDurationMinutes', substituteStopsDurationMinutes);
    if (substituteConsumption.length > 0) {
      formData.set('consumption', JSON.stringify(
        substituteConsumption
          .filter((row) => row.productId && row.quantity)
          .map((row) => ({ productId: row.productId, quantity: Number(row.quantity) })),
      ));
    }
    formData.set('workers', workersPayload(substituteWorkers));

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
        <div className="table-scroll">
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
                // Анкер строки РЦ: deep-link уведомлений EV-02/EV-08 ведёт прямо на строку (M09 §7).
                <tr
                  key={line.id}
                  id={'line-' + line.id}
                  className="scroll-mt-24 hover:bg-neutral-100"
                >
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
                              {/* Категория обязательна: на ГП-РЦ вносят и ГП, и ПФ, и без подписи
                                  две строки факта выглядят неразличимо (Р-01). */}
                              Выпуск {factCategoryLabel(fact.factCategory)}: {fact.quantity.toString()} | Брак:{' '}
                              {fact.defectQuantity.toString()}
                              {fact.defectReason ? ` (${fact.defectReason.name})` : ''}
                              {fact.stopsDurationMinutes > 0 ? ` | Остановки: ${fact.stopsDurationMinutes} мин` : ''}
                            </p>
                            {fact.consumptions.length > 0 && (
                              <p className="text-xs text-machine-gray">
                                Потребление:{' '}
                                {fact.consumptions
                                  .map(
                                    (item) =>
                                      item.product.name +
                                      ' ' +
                                      item.quantity.toString() +
                                      ' ' +
                                      item.product.unit,
                                  )
                                  .join(' · ')}
                              </p>
                            )}
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
                    {canCreateTransfer && line.product.category === 'GP' && (
                      <div className="space-y-1">
                        <Link href={transferCreateHref(line)}>
                          <Button variant="secondary" size="sm">
                            Создать перемещение
                          </Button>
                        </Link>
                        {/* Предупреждение, а не блокировка: второе перемещение бывает законным
                            (возврат на доработку, повторный выпуск по той же строке). */}
                        {(line.transferLines ?? []).length > 0 && (
                          <p className="text-xs text-signal-amber">
                            Уже создано перемещение:{' '}
                            {(line.transferLines ?? []).map((transfer, index) => (
                              <span key={transfer.id}>
                                {index > 0 ? ', ' : ''}
                                <Link
                                  href={'/transfers/' + transfer.goodsTransferId}
                                  className="underline decoration-dotted"
                                >
                                  {transfer.goodsTransferId.slice(0, 8)}
                                </Link>{' '}
                                ({TRANSFER_STATUS_LABELS[transfer.goodsTransfer.status] ?? transfer.goodsTransfer.status})
                              </span>
                            ))}
                          </p>
                        )}
                      </div>
                    )}
                    {canCorrectFact && line.facts.length > 0 && (
                      <div className="space-y-2">
                        {line.facts.map((fact) => (
                          <Button
                            key={fact.id}
                            variant="cta"
                            size="sm"
                            disabled={isPending}
                            onClick={() => openCorrectFactDialog(fact, line.id)}
                          >
                            {/* ОПЭ-57: при двух фактах (ГП и ПФ) кнопки без подписи неразличимы,
                                а на широком экране они встают в одну строку — категория обязательна. */}
                            Корректировать {factCategoryLabel(fact.factCategory as 'MASS' | 'GP' | 'PF')}
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
        {confirmError && <p className="mt-2 text-sm text-signal-amber">{confirmError}</p>}
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
        size="lg"
        title={
          correctFactCategory
            ? `Корректировать факт — ${factCategoryLabel(correctFactCategory)}`
            : 'Корректировать факт'
        }
      >
        <form onSubmit={handleCorrectFactSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="correct-quantity">
              Выпуск{correctFactCategory ? ` ${factCategoryLabel(correctFactCategory)}` : ''}
            </Label>
            <input
              id="correct-quantity"
              type="number"
              min="0"
              step="1"
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
              step="1"
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
          {!correctLineProducesMass() && (
            <ConsumptionEditor
              idPrefix="correct"
              rows={correctConsumption}
              products={consumableForLine(correctLineId)}
              onChange={setCorrectConsumption}
            />
          )}
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
          <WorkerCompositionEditor
            rows={correctWorkers}
            absenceReasons={absenceReasons}
            workerCandidates={workerCandidates}
            disabled={isPending}
            onChange={setCorrectWorkers}
          />
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
        // ОПЭ-45: та же ширина, что у оператора — иначе не видно наименование и количество.
        size="lg"
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

          <div className="space-y-2">
            <Label htmlFor="substitute-output">
              {productCategoryForSubstituteLine() === 'MASS' ? 'Выпуск Массы' : 'Выпуск ГП'}
            </Label>
            <input
              id="substitute-output"
              type="number"
              min="0"
              step="1"
              value={substituteOutput}
              onChange={(e) => setSubstituteOutput(e.target.value)}
              required={productCategoryForSubstituteLine() === 'MASS'}
              placeholder="Укажите фактический выпуск"
              className="flex h-10 w-full rounded-md border border-mist-metal bg-white px-3 py-2 text-base text-graphite placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-deep-industry-blue"
            />
          </div>

          {productCategoryForSubstituteLine() === 'GP' && (
            <div className="space-y-2">
              <Label htmlFor="substitute-output-pf">Выпуск ПФ</Label>
              <input
                id="substitute-output-pf"
                type="number"
                min="0"
                step="1"
                value={substituteOutputPF}
                onChange={(e) => setSubstituteOutputPF(e.target.value)}
                placeholder="Полуфабрикат (необязательно)"
                className="flex h-10 w-full rounded-md border border-mist-metal bg-white px-3 py-2 text-base text-graphite placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-deep-industry-blue"
              />
            </div>
          )}

          {productCategoryForSubstituteLine() === 'GP' && (
            <ConsumptionEditor
              idPrefix="substitute"
              rows={substituteConsumption}
              products={consumableForLine(substituteLineId)}
              onChange={setSubstituteConsumption}
            />
          )}

          <div className="space-y-2">
            <Label htmlFor="substitute-defect-quantity">Брак</Label>
            <input
              id="substitute-defect-quantity"
              type="number"
              min="0"
              step="1"
              value={substituteDefectQuantity}
              onChange={(e) => setSubstituteDefectQuantity(e.target.value)}
              placeholder="Количество брака"
              className="flex h-10 w-full rounded-md border border-mist-metal bg-white px-3 py-2 text-base text-graphite placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-deep-industry-blue"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="substitute-defect-reason">Причина брака</Label>
            <Select
              id="substitute-defect-reason"
              value={substituteDefectReasonId}
              onChange={(e) => setSubstituteDefectReasonId(e.target.value)}
              options={defectReasons.map((reason) => ({ value: reason.id, label: reason.name }))}
              placeholder="Выберите причину"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="substitute-stops-count">Остановки (количество)</Label>
            <input
              id="substitute-stops-count"
              type="number"
              min="0"
              step="1"
              value={substituteStopsCount}
              onChange={(e) => setSubstituteStopsCount(e.target.value)}
              placeholder="Количество остановок"
              className="flex h-10 w-full rounded-md border border-mist-metal bg-white px-3 py-2 text-base text-graphite placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-deep-industry-blue"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="substitute-stops-duration">Остановки (минут)</Label>
            <input
              id="substitute-stops-duration"
              type="number"
              min="0"
              step="1"
              value={substituteStopsDurationMinutes}
              onChange={(e) => setSubstituteStopsDurationMinutes(e.target.value)}
              placeholder="Общая длительность остановок, мин"
              className="flex h-10 w-full rounded-md border border-mist-metal bg-white px-3 py-2 text-base text-graphite placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-deep-industry-blue"
            />
          </div>

          <WorkerCompositionEditor
            rows={substituteWorkers}
            absenceReasons={absenceReasons}
            workerCandidates={workerCandidates}
            disabled={isPending}
            onChange={setSubstituteWorkers}
          />

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
