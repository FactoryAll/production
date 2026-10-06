'use client';

import { useState } from 'react';
import { Button, Dialog, Input, Switch } from '@prodtrack/ui';
import { createEmployee, updateEmployee, type EmployeeInput } from '../actions';
import type { Employee } from '@prisma/client';

interface EmployeeDialogProps {
  open: boolean;
  onClose: () => void;
  initial?: Employee | null;
}

export function EmployeeDialog({ open, onClose, initial }: EmployeeDialogProps) {
  const isEdit = Boolean(initial);
  const [fullName, setFullName] = useState(initial?.fullName ?? '');
  const [tabNumber, setTabNumber] = useState(initial?.tabNumber ?? '');
  const [canBeWorker, setCanBeWorker] = useState(initial?.canBeWorker ?? true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const input: EmployeeInput = {
      fullName: fullName.trim(),
      tabNumber: tabNumber.trim(),
      canBeWorker,
    };

    try {
      if (isEdit && initial) {
        await updateEmployee(initial.id, input);
      } else {
        await createEmployee(input);
      }
      setFullName('');
      setTabNumber('');
      setCanBeWorker(true);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Неизвестная ошибка');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={isEdit ? 'Редактировать сотрудника' : 'Создать сотрудника'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="e-fullName" className="block text-base font-medium text-graphite">ФИО</label>
          <Input
            id="e-fullName"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Иванов Иван Иванович"
            disabled={loading}
            required
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="e-tabNumber" className="block text-base font-medium text-graphite">Табельный номер</label>
          <Input
            id="e-tabNumber"
            value={tabNumber}
            onChange={(e) => setTabNumber(e.target.value)}
            placeholder="Например, 000123"
            disabled={loading}
            required
          />
        </div>
        <div className="space-y-1">
          <Switch
            checked={canBeWorker}
            onChange={setCanBeWorker}
            label="Может привлекаться работником РЦ"
          />
          <p className="text-sm text-neutral-500">
            Снятый признак убирает сотрудника из списка работников в форме ПЗ (T-071).
          </p>
        </div>
        {error && (
          <p className="text-sm text-signal-amber">{error}</p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
            Отмена
          </Button>
          <Button type="submit" disabled={loading || !fullName.trim() || !tabNumber.trim()}>
            {loading ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
