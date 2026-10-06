'use client';

import { useState, useTransition } from 'react';
import { Button, Card, Input, Label } from '@prodtrack/ui';
import { clearDataAction } from './actions';
import { CLEAR_CONFIRMATION_WORD, type DataGroupCount } from '@/lib/data-cleanup';

interface DataCleanupPageProps {
  groups: DataGroupCount[];
}

export default function DataCleanupPage({ groups }: DataCleanupPageProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState('');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function toggle(key: string) {
    setSelected((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));
  }

  const selectedRecords = groups
    .filter((group) => selected.includes(group.key))
    .reduce((sum, group) => sum + group.records, 0);
  const canSubmit =
    !isPending &&
    selected.length > 0 &&
    confirmation.trim().toUpperCase() === CLEAR_CONFIRMATION_WORD;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setDone(null);

    startTransition(async () => {
      const result = await clearDataAction(selected, confirmation);
      if (!result.success) {
        setError(result.error ?? 'Не удалось очистить данные');
        return;
      }
      const total = (result.removed ?? []).reduce((sum, item) => sum + item.records, 0);
      setDone('Удалено записей: ' + total + '. Очистка записана в журнал аудита.');
      setSelected([]);
      setConfirmation('');
    });
  }

  return (
    <div className="space-y-4 p-6">
      <h1 className="text-2xl font-semibold text-graphite">Данные</h1>
      <p className="text-sm text-neutral-600">
        Очистка тестовых данных. Удаляются только документы и то, что из них следует: ПЗ, факты и итоги
        смен, перемещения, остатки, задачи для 1С, уведомления, хронометраж. Справочники, пользователи,
        роли и журнал аудита остаются на месте — система продолжает работать.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Card className="space-y-3">
          {groups.map((group) => (
            <label key={group.key} className="flex items-start gap-3 text-sm text-graphite">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-neutral-300 text-deep-industry-blue focus:ring-deep-industry-blue"
                checked={selected.includes(group.key)}
                onChange={() => toggle(group.key)}
              />
              <span>
                <span className="font-medium">{group.label}</span>
                <span className="text-machine-gray"> — {group.records} записей</span>
                <span className="block text-neutral-600">{group.description}</span>
              </span>
            </label>
          ))}
        </Card>

        <Card className="space-y-2">
          <Label htmlFor="confirmation">
            Для подтверждения введите {CLEAR_CONFIRMATION_WORD}
          </Label>
          <Input
            id="confirmation"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder={CLEAR_CONFIRMATION_WORD}
          />
          <p className="text-sm text-signal-amber">
            Удаление необратимо. Выбрано групп: {selected.length}, записей: {selectedRecords}.
          </p>
        </Card>

        {error && <p className="text-sm text-signal-amber">{error}</p>}
        {done && <p className="text-sm text-graphite">{done}</p>}

        <Button type="submit" variant="danger" disabled={!canSubmit}>
          {isPending ? 'Очистка...' : 'Очистить выбранное'}
        </Button>
      </form>
    </div>
  );
}
