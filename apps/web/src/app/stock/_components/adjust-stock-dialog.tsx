'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog, Input, Label, Select } from '@prodtrack/ui';
import {
  STOCK_ADJUSTMENT_DIRECTION_LABELS,
  STOCK_ADJUSTMENT_REASON_OPTIONS,
  stockAdjustmentReasonLabel,
  type StockAdjustmentReasonCode,
} from '@/lib/stock-adjustment';
import { formatQuantity } from '@/lib/quantity';
import type { StockCategory } from '@prisma/client';

export interface AdjustDialogTarget {
  warehouseId: string;
  warehouseName: string;
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  stockCategory: StockCategory;
  /** Текущий остаток: по нему видно, сколько можно списать. */
  available: number;
}

const CATEGORY_LABELS: Record<StockCategory, string> = {
  MASS: 'Масса',
  PF: 'ПФ',
  GP: 'ГП',
};

/**
 * Диалог «Скорректировать остаток» (M05, решение владельца 18.11.2026).
 *
 * Позиция приходит из строки «Остатков» — склад, номенклатура и категория уже известны,
 * человек вводит только направление, количество и причину. Позицию не выбирают: корректируют
 * ровно ту строку, где увидели расхождение.
 */
export function AdjustStockDialog({
  target,
  open,
  onClose,
}: {
  target: AdjustDialogTarget | null;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [direction, setDirection] = useState<'RECEIPT' | 'ISSUE'>('RECEIPT');
  // Причина не подставляется по умолчанию: «Инвентаризация» вместо «Ошибка учёта» —
  // это уже неверная запись в журнале, а человек её не заметит.
  const [reasonCode, setReasonCode] = useState<StockAdjustmentReasonCode | ''>('');
  const [reason, setReason] = useState('');
  const [basisDocument, setBasisDocument] = useState('');
  const [quantity, setQuantity] = useState(() => (target && target.available < 0 ? String(Math.abs(target.available)) : ''));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ number: string } | null>(null);
  const [isPending, setIsPending] = useState(false);

  if (!target) return null;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsPending(true);
    try {
      const { createStockAdjustmentAction } = await import('@/app/stock/adjustments/actions');
      const formData = new FormData();
      formData.set('reasonCode', reasonCode);
      formData.set('reason', reason);
      if (basisDocument.trim()) formData.set('basisDocument', basisDocument.trim());
      formData.set(
        'lines',
        JSON.stringify([
          {
            warehouseId: target.warehouseId,
            productId: target.productId,
            stockCategory: target.stockCategory,
            direction,
            quantity: Number(quantity),
          },
        ]),
      );
      const result = await createStockAdjustmentAction(formData);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setSaved({ number: result.number });
      router.refresh();
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} size="md" title="Скорректировать остаток">
      {saved ? (
        <div className="space-y-4">
          <p className="text-sm text-graphite">
            Корректировка {saved.number} сохранена. Остаток обновлён, история движений не правилась —
            добавлено компенсирующее движение.
          </p>
          <div className="flex justify-end">
            <Button type="button" variant="cta" onClick={onClose}>
              Закрыть
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-md bg-neutral-100 p-3 text-sm text-graphite">
            <div>
              {target.productCode} — {target.productName}
            </div>
            <div className="text-machine-gray">
              {target.warehouseName} · {CATEGORY_LABELS[target.stockCategory]} · текущий остаток{' '}
              {formatQuantity(target.available)} {target.unit}
            </div>
          </div>

          {/* Два столбца: модалка обязана влезать в ноутбучный экран целиком,
              иначе кнопка сохранения уезжает за нижний край. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="adjust-direction">Направление</Label>
              <Select
                id="adjust-direction"
                value={direction}
                onChange={(e) => setDirection(e.target.value as 'RECEIPT' | 'ISSUE')}
                options={[
                  { value: 'RECEIPT', label: STOCK_ADJUSTMENT_DIRECTION_LABELS.RECEIPT },
                  { value: 'ISSUE', label: STOCK_ADJUSTMENT_DIRECTION_LABELS.ISSUE },
                ]}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="adjust-quantity">Количество</Label>
              <Input
                id="adjust-quantity"
                type="number"
                min="1"
                step="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="Сколько добавить или списать"
                required
              />
            </div>
          </div>
          {direction === 'ISSUE' && (
            <p className="text-xs text-machine-gray">
              Списать можно не больше остатка: {formatQuantity(Math.max(target.available, 0))} {target.unit}
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="adjust-reason-code">Причина</Label>
              <Select
                id="adjust-reason-code"
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value as StockAdjustmentReasonCode)}
                options={STOCK_ADJUSTMENT_REASON_OPTIONS.map((option) => ({
                  value: option.value,
                  label: option.label,
                }))}
                placeholder="Выберите причину"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="adjust-basis">Основание (необязательно)</Label>
              <Input
                id="adjust-basis"
                value={basisDocument}
                onChange={(e) => setBasisDocument(e.target.value)}
                placeholder="Акт № … от …"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="adjust-reason">Что произошло (не короче 10 символов)</Label>
            <textarea
              id="adjust-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Например: при инвентаризации 18.11 обнаружено, что Масса списана дважды"
              rows={2}
              required
              className="flex min-h-[60px] w-full rounded-md border border-mist-metal bg-white px-3 py-2 text-base text-graphite placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-deep-industry-blue"
            />
          </div>

          {error && <p className="text-sm text-signal-amber">{error}</p>}

          <div className="mt-6 flex justify-end gap-3">
            <Button variant="secondary" type="button" onClick={onClose} disabled={isPending}>
              Отмена
            </Button>
            <Button variant="cta" type="submit" disabled={isPending}>
              {isPending ? 'Сохранение...' : 'Сохранить корректировку'}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

/** Подпись выбранной причины — вынесена, чтобы не тянуть словарь в каждый вызов. */
export function reasonLabel(code: string): string {
  return stockAdjustmentReasonLabel(code);
}
