'use client';

import { useState } from 'react';
import { Button, Dialog, Input } from '@prodtrack/ui';
import { createProduct, updateProduct, type ProductInput } from '../actions';
import { ProductCategory } from '@prodtrack/contracts';
import type { Product } from '@prisma/client';

interface ProductDialogProps {
  open: boolean;
  onClose: () => void;
  initial?: Product | null;
}

const CATEGORY_OPTIONS = [
  { value: ProductCategory.MASS, label: 'Масса' },
  { value: ProductCategory.GP, label: 'ГП' },
];

export function ProductDialog({ open, onClose, initial }: ProductDialogProps) {
  const isEdit = Boolean(initial);
  const [code, setCode] = useState(initial?.code ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [category, setCategory] = useState<ProductCategory>(
    (initial?.category as ProductCategory) ?? ProductCategory.MASS,
  );
  const [unit, setUnit] = useState(initial?.unit ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const input: ProductInput = {
      code: code.trim(),
      name: name.trim(),
      category,
      unit: unit.trim(),
    };

    try {
      if (isEdit && initial) {
        await updateProduct(initial.id, input);
      } else {
        await createProduct(input);
      }
      setCode('');
      setName('');
      setCategory(ProductCategory.MASS);
      setUnit('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Неизвестная ошибка');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={isEdit ? 'Редактировать номенклатуру' : 'Создать номенклатуру'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="p-code" className="block text-base font-medium text-graphite">Код</label>
          <Input
            id="p-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Например, SKU-001"
            disabled={loading}
            required
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="p-name" className="block text-base font-medium text-graphite">Наименование</label>
          <Input
            id="p-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Название номенклатуры"
            disabled={loading}
            required
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="p-category" className="block text-base font-medium text-graphite">Категория</label>
          <select
            id="p-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as ProductCategory)}
            disabled={loading}
            required
            className="h-[var(--button-height-sm)] w-full rounded-md border border-mist-metal bg-white px-3 text-graphite"
          >
            {CATEGORY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <label htmlFor="p-unit" className="block text-base font-medium text-graphite">Единица измерения</label>
          <Input
            id="p-unit"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="кг, л, шт, уп"
            disabled={loading}
            required
            maxLength={20}
          />
        </div>
        {error && (
          <p className="text-sm text-signal-amber">{error}</p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
            Отмена
          </Button>
          <Button type="submit" disabled={loading || !code.trim() || !name.trim() || !unit.trim()}>
            {loading ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
