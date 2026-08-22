'use client';

import { useState } from 'react';
import { Button, Dialog, Input } from '@prodtrack/ui';
import { createWorkCenter, updateWorkCenter, type WorkCenterInput } from '../actions';
import type { WorkCenter } from '@prisma/client';

interface WorkCenterDialogProps {
  open: boolean;
  onClose: () => void;
  initial?: WorkCenter | null;
}

export function WorkCenterDialog({ open, onClose, initial }: WorkCenterDialogProps) {
  const isEdit = Boolean(initial);
  const [code, setCode] = useState(initial?.code ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const input: WorkCenterInput = { code: code.trim(), name: name.trim() };

    try {
      if (isEdit && initial) {
        await updateWorkCenter(initial.id, input);
      } else {
        await createWorkCenter(input);
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
    <Dialog open={open} onClose={onClose} title={isEdit ? 'Редактировать РЦ' : 'Создать РЦ'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="wc-code" className="block text-base font-medium text-graphite">Код</label>
          <Input
            id="wc-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Например, 01"
            disabled={loading}
            required
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="wc-name" className="block text-base font-medium text-graphite">Наименование</label>
          <Input
            id="wc-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="01.Реактор"
            disabled={loading}
            required
          />
        </div>
        {isEdit && initial && (
          <p className="text-sm text-graphite">
            Производит массу: {initial.producesMass ? 'да' : 'нет'} (вычисляется автоматически по коду)
          </p>
        )}
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
