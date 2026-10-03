'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, Select, Input, Label, Card } from '@prodtrack/ui';
import { createGoodsTransferAction } from '../actions';
import {
  formatQuantity,
  getAvailableQuantity,
  isQuantityOverAvailable,
  parseQuantityInput,
  type StockByWarehouse,
} from '../availability';
import type { Warehouse, Product } from '@prisma/client';

interface TransferFormProps {
  warehouses: Warehouse[];
  products: Product[];
  stockByWarehouse: StockByWarehouse;
}

interface LineDraft {
  id: string;
  productId: string;
  plannedQuantity: string;
}

function makeLineId(): string {
  return 'line_' + Math.random().toString(36).slice(2, 9);
}

function emptyLine(): LineDraft {
  return { id: makeLineId(), productId: '', plannedQuantity: '' };
}

export default function TransferForm({ warehouses, products, stockByWarehouse }: TransferFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [sourceWarehouseId, setSourceWarehouseId] = useState('');
  const [destinationWarehouseId, setDestinationWarehouseId] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(id: string) {
    setLines((prev) => prev.filter((line) => line.id !== id));
  }

  function updateLine(id: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  }

  const destinationOptions = warehouses
    .filter((w) => w.id !== sourceWarehouseId)
    .map((w) => ({
      value: w.id,
      label: w.name + (w.active ? '' : ' (деактивирован)'),
    }));

  const productOptions = products.map((p) => ({
    value: p.id,
    label: `${p.code} – ${p.name} (${p.unit})` + (p.active ? '' : ' (деактивирован)'),
  }));

  function getProduct(productId: string): Product | undefined {
    return products.find((p) => p.id === productId);
  }

  function getLineAvailable(productId: string): number {
    return getAvailableQuantity(stockByWarehouse, sourceWarehouseId, productId);
  }

  function getLineOverflow(line: LineDraft): boolean {
    const quantity = parseQuantityInput(line.plannedQuantity);
    return isQuantityOverAvailable(quantity, getLineAvailable(line.productId));
  }

  function validate(): string | null {
    if (sourceWarehouseId === destinationWarehouseId) {
      return 'Склад-источник и склад-приёмник должны различаться';
    }
    if (lines.length === 0) {
      return 'Добавьте хотя бы одну строку';
    }
    const seenProducts = new Set<string>();
    for (const line of lines) {
      if (!line.productId) return 'Укажите продукт';
      const qty = parseQuantityInput(line.plannedQuantity);
      if (qty === null || qty <= 0) return 'Количество должно быть больше 0';
      if (seenProducts.has(line.productId)) return 'Продукт в перемещении не может повторяться';

      const available = getLineAvailable(line.productId);
      if (qty > available) {
        const product = getProduct(line.productId);
        return `Недостаточно остатка для продукта ${product?.name ?? ''}: требуется ${formatQuantity(qty)}, доступно ${formatQuantity(available)}`;
      }

      seenProducts.add(line.productId);
    }
    return null;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    const payloadLines = lines.map((line) => ({
      productId: line.productId,
      plannedQuantity: Number(parseQuantityInput(line.plannedQuantity)),
    }));

    const formData = new FormData();
    formData.set('sourceWarehouseId', sourceWarehouseId);
    formData.set('destinationWarehouseId', destinationWarehouseId);
    formData.set('lines', JSON.stringify(payloadLines));

    startTransition(async () => {
      const result = await createGoodsTransferAction(formData);
      if (result.success) {
        router.push('/transfers');
      } else {
        setError(result.error ?? 'Не удалось создать перемещение');
      }
    });
  }

  const hasOverflow = lines.some((line) => line.productId !== '' && getLineOverflow(line));

  const canSubmit =
    !isPending &&
    !hasOverflow &&
    sourceWarehouseId !== '' &&
    destinationWarehouseId !== '' &&
    lines.every((line) => line.productId !== '' && line.plannedQuantity.trim() !== '');

  const warehouseOptions = warehouses.map((w) => ({
    value: w.id,
    label: w.name + (w.active ? '' : ' (деактивирован)'),
  }));

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-graphite">Создание перемещения</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="source">Склад-источник</Label>
              <Select
                id="source"
                value={sourceWarehouseId}
                onChange={(e) => {
                  setSourceWarehouseId(e.target.value);
                  if (destinationWarehouseId === e.target.value) {
                    setDestinationWarehouseId('');
                  }
                }}
                options={warehouseOptions}
                placeholder="Выберите склад-источник"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="destination">Склад-приёмник</Label>
              <Select
                id="destination"
                value={destinationWarehouseId}
                onChange={(e) => setDestinationWarehouseId(e.target.value)}
                options={destinationOptions}
                placeholder="Выберите склад-приёмник"
                required
              />
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <h2 className="text-lg font-medium text-graphite">Строки перемещения</h2>
          {lines.map((line, index) => {
            const product = getProduct(line.productId);
            const available = getLineAvailable(line.productId);
            const overflow = line.productId !== '' && getLineOverflow(line);
            const showAvailable = sourceWarehouseId !== '' && line.productId !== '';

            return (
              <Card key={line.id} className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-graphite">Строка {index + 1}</span>
                  {lines.length > 1 && (
                    <Button type="button" variant="secondary" size="sm" onClick={() => removeLine(line.id)}>
                      Удалить
                    </Button>
                  )}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor={line.id + '_product'}>Продукт</Label>
                    <Select
                      id={line.id + '_product'}
                      value={line.productId}
                      onChange={(e) => updateLine(line.id, { productId: e.target.value })}
                      options={productOptions}
                      placeholder="Выберите продукт"
                      required
                    />
                    {line.productId && !product?.active && (
                      <p className="text-sm text-signal-amber">Эта номенклатура деактивирована. Выберите другую.</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={line.id + '_qty'}>Плановое количество</Label>
                    <Input
                      id={line.id + '_qty'}
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={line.plannedQuantity}
                      onChange={(e) => updateLine(line.id, { plannedQuantity: e.target.value })}
                      placeholder={showAvailable ? formatQuantity(available) : '0.00'}
                      aria-invalid={overflow}
                      className={overflow ? 'border-red-500 focus:ring-red-500' : ''}
                      required
                    />
                    {showAvailable ? (
                      <p className={`text-sm ${overflow ? 'text-red-600' : 'text-neutral-500'}`}>
                        {overflow
                          ? `Недостаточно остатка: доступно ${formatQuantity(available)} ${product?.unit ?? ''}`
                          : `Доступно на складе-источнике: ${formatQuantity(available)} ${product?.unit ?? ''}`}
                      </p>
                    ) : (
                      <p className="text-sm text-neutral-500">
                        Выберите склад-источник и продукт, чтобы увидеть доступный остаток
                      </p>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}

          <Button type="button" variant="secondary" onClick={addLine}>
            + Добавить строку
          </Button>
        </div>

        {error && <p className="text-sm text-signal-amber">{error}</p>}

        <div className="flex items-center justify-end gap-3">
          <Link href="/transfers">
            <Button type="button" variant="secondary" disabled={isPending}>Отмена</Button>
          </Link>
          <Button type="submit" variant="cta" disabled={!canSubmit}>
            {isPending ? 'Сохранение...' : 'Сохранить черновик'}
          </Button>
        </div>
      </form>
    </div>
  );
}
