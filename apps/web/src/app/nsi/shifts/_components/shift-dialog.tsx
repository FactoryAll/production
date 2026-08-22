'use client';

import { useState, useMemo } from 'react';
import { Button, Dialog, Input } from '@prodtrack/ui';
import { createShift, updateShift, type ShiftInput } from '../actions';
import type { Shift } from '@prisma/client';

interface ShiftDialogProps {
  open: boolean;
  onClose: () => void;
  initial?: Shift | null;
}

function formatDateForInput(date: Date): string {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function ShiftDialog({ open, onClose, initial }: ShiftDialogProps) {
  const isEdit = Boolean(initial);
  const [number, setNumber] = useState<1 | 2>((initial?.number as 1 | 2) ?? 1);
  const [date, setDate] = useState(initial ? formatDateForInput(initial.date) : '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const times = useMemo(() => {
    return number === 1 ? { start: '08:00', end: '20:00' } : { start: '20:00', end: '08:00' };
  }, [number]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const input: ShiftInput = { number, date };

    try {
      if (isEdit && initial) {
        await updateShift(initial.id, input);
      } else {
        await createShift(input);
      }
      setNumber(1);
      setDate('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Неизвестная ошибка');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={isEdit ? 'Редактировать смену' : 'Создать смену'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="s-number" className="block text-base font-medium text-graphite">Номер смены</label>
          <select
            id="s-number"
            value={number}
            onChange={(e) => setNumber(Number(e.target.value) as 1 | 2)}
            disabled={loading}
            required
            className="h-[var(--button-height-sm)] w-full rounded-md border border-mist-metal bg-white px-3 text-graphite"
          >
            <option value={1}>Смена 1 (08:00–20:00)</option>
            <option value={2}>Смена 2 (20:00–08:00)</option>
          </select>
        </div>
        <div className="space-y-2">
          <label htmlFor="s-date" className="block text-base font-medium text-graphite">Дата</label>
          <Input
            id="s-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={loading}
            required
          />
        </div>
        <div className="rounded-md bg-graphite-surface p-3 text-sm text-graphite">
          Время смены: {times.start} – {times.end}
        </div>
        {error && (
          <p className="text-sm text-signal-amber">{error}</p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
            Отмена
          </Button>
          <Button type="submit" disabled={loading || !date}>
            {loading ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
