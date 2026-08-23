'use client';

import { useState } from 'react';
import { Button, Dialog, Input } from '@prodtrack/ui';
import { createDefectReason, updateDefectReason, type DefectReasonInput } from '../actions';
import type { DefectReason } from '@prisma/client';

interface DefectReasonDialogProps {
  open: boolean;
  onClose: () => void;
  initial?: DefectReason | null;
}

export function DefectReasonDialog({ open, onClose, initial }: DefectReasonDialogProps) {
  const isEdit = Boolean(initial);
  const [code, setCode] = useState(initial?.code ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const input: DefectReasonInput = { code: code.trim(), name: name.trim() };

    try {
      if (isEdit && initial) {
        await updateDefectReason(initial.id, input);
      } else {
        await createDefectReason(input);
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
    <Dialog open={open} onClose={onClose} title={isEdit ? 'Редактировать причину брака' : 'Создать причину брака'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="dr-code" className="block text-base font-medium text-graphite">Код</label>
          <Input
            id="dr-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Например, DEFECT_A"
            disabled={loading}
            required
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="dr-name" className="block text-base font-medium text-graphite">Наименование</label>
          <Input
            id="dr-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Описание причины брака"
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
