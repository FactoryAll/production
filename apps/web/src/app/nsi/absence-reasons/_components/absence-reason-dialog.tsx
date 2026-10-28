'use client';

import { useState } from 'react';
import { Button, Dialog, Input } from '@prodtrack/ui';
import { createAbsenceReason, updateAbsenceReason, type AbsenceReasonInput } from '../actions';
import type { AbsenceReason } from '@prisma/client';

interface AbsenceReasonDialogProps {
  open: boolean;
  onClose: () => void;
  initial?: AbsenceReason | null;
}

export function AbsenceReasonDialog({ open, onClose, initial }: AbsenceReasonDialogProps) {
  const isEdit = Boolean(initial);
  const [code, setCode] = useState(initial?.code ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const input: AbsenceReasonInput = { code: code.trim(), name: name.trim() };

    try {
      if (isEdit && initial) {
        await updateAbsenceReason(initial.id, input);
      } else {
        await createAbsenceReason(input);
      }
      setCode('');
      setName('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Неизвестная ошибка');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={isEdit ? 'Редактировать причину неявки' : 'Создать причину неявки'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="ar-code" className="block text-base font-medium text-graphite">Код</label>
          <Input
            id="ar-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Например, ILLNESS"
            disabled={loading}
            required
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="ar-name" className="block text-base font-medium text-graphite">Наименование</label>
          <Input
            id="ar-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Описание причины неявки"
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
          <Button type="submit" disabled={loading || !code.trim() || !name.trim()}>
            {loading ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
