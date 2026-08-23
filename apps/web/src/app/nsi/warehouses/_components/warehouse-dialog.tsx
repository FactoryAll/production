'use client';

import { useState } from 'react';
import { Button, Dialog, Input } from '@prodtrack/ui';
import { updateWarehouse, type WarehouseInput } from '../actions';
import type { Warehouse } from '@prisma/client';

interface WarehouseDialogProps {
  open: boolean;
  onClose: () => void;
  initial: Warehouse;
}

export function WarehouseDialog({ open, onClose, initial }: WarehouseDialogProps) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const input: WarehouseInput = {
      name: name.trim(),
      description: description.trim() || undefined,
    };

    try {
      await updateWarehouse(initial.id, input);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Неизвестная ошибка');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Редактировать склад">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="w-name" className="block text-base font-medium text-graphite">Название</label>
          <Input
            id="w-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Название склада"
            disabled={loading}
            required
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="w-description" className="block text-base font-medium text-graphite">Описание</label>
          <Input
            id="w-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Описание (необязательно)"
            disabled={loading}
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
