'use client';

import { useState } from 'react';
import { Button, Dialog, Input } from '@prodtrack/ui';
import { createSubstitutionReason, updateSubstitutionReason, type SubstitutionReasonInput } from '../actions';
import { SubstitutionReason } from '@prodtrack/contracts';
import type { SubstitutionReason as PrismaSubstitutionReason } from '@prisma/client';

interface SubstitutionReasonDialogProps {
  open: boolean;
  onClose: () => void;
  initial?: PrismaSubstitutionReason | null;
}

const REASON_OPTIONS = [
  { value: SubstitutionReason.ILLNESS, label: 'Болезнь' },
  { value: SubstitutionReason.NO_SHOW, label: 'Неявка' },
  { value: SubstitutionReason.LEFT_SHIFT, label: 'Ушёл во время смены' },
  { value: SubstitutionReason.OTHER, label: 'Прочее' },
];

export function SubstitutionReasonDialog({ open, onClose, initial }: SubstitutionReasonDialogProps) {
  const isEdit = Boolean(initial);
  const [code, setCode] = useState<SubstitutionReason>(
    (initial?.code as SubstitutionReason) ?? SubstitutionReason.ILLNESS,
  );
  const [name, setName] = useState(initial?.name ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const input: SubstitutionReasonInput = { code, name: name.trim() };

    try {
      if (isEdit && initial) {
        await updateSubstitutionReason(initial.id, input);
      } else {
        await createSubstitutionReason(input);
      }
      setCode(SubstitutionReason.ILLNESS);
      setName('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Неизвестная ошибка');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={isEdit ? 'Редактировать причину ввода за Оператора' : 'Создать причину ввода за Оператора'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="sr-code" className="block text-base font-medium text-graphite">Код</label>
          <select
            id="sr-code"
            value={code}
            onChange={(e) => setCode(e.target.value as SubstitutionReason)}
            disabled={loading || isEdit}
            required
            className="h-[var(--button-height-sm)] w-full rounded-md border border-mist-metal bg-white px-3 text-graphite"
          >
            {REASON_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <label htmlFor="sr-name" className="block text-base font-medium text-graphite">Наименование</label>
          <Input
            id="sr-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Описание причины"
            disabled={loading}
            required
          />
        </div>
        {error && (
          <p className="text-sm text-signal-amber">{error}</p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
            Отмена
          </Button>
          <Button type="submit" disabled={loading || !name.trim()}>
            {loading ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
