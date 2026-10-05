'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog } from '@prodtrack/ui';
import { markTaskProcessedAction, unmarkTaskProcessedAction } from '../actions';

interface TaskActionsProps {
  taskId: string;
  status: 'PENDING' | 'PROCESSED' | 'CANCELLED';
}

/**
 * Действия задачи для 1С (T-052, M12 §8, BR-4/BR-8, Р-17).
 *
 * «Отметить обработано» — без диалога; «Отменить обработку» требует причину (Р-17).
 * Ошибка серверного действия показывается пользователю, а диалог отмены остаётся открытым,
 * чтобы причину можно было исправить (дефект 6/8.1 ручного тестирования v1.1.x).
 */
export default function TaskActions({ taskId, status }: TaskActionsProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [isUnmarkOpen, setIsUnmarkOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [unmarkError, setUnmarkError] = useState<string | null>(null);
  const [isUnmarkPending, setIsUnmarkPending] = useState(false);

  async function handleMark() {
    setMessage(null);
    setError(null);
    setIsPending(true);

    try {
      const result = await markTaskProcessedAction(taskId);
      if (result.success) {
        setMessage('Задача отмечена как обработанная');
        router.refresh();
      } else {
        setError(result.error);
      }
    } finally {
      setIsPending(false);
    }
  }

  async function handleUnmark() {
    setUnmarkError(null);
    setIsUnmarkPending(true);

    try {
      const formData = new FormData();
      formData.set('reason', reason);

      const result = await unmarkTaskProcessedAction(taskId, formData);
      if (result.success) {
        setIsUnmarkOpen(false);
        setReason('');
        router.refresh();
      } else {
        // Диалог остаётся открытым: пользователь видит причину отказа и может её исправить.
        setUnmarkError(result.error);
      }
    } finally {
      setIsUnmarkPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {status === 'PENDING' && (
          <Button type="button" onClick={handleMark} disabled={isPending}>
            {isPending ? 'Отметка…' : 'Отметить обработано'}
          </Button>
        )}

        {status === 'PROCESSED' && (
          <Button type="button" variant="secondary" onClick={() => setIsUnmarkOpen(true)}>
            Отменить обработку
          </Button>
        )}
      </div>

      {message && (
        <p role="status" className="text-sm text-graphite">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-alert">
          {error}
        </p>
      )}

      <Dialog open={isUnmarkOpen} onClose={() => setIsUnmarkOpen(false)} title="Отмена отметки «обработано»">
        <div className="space-y-4">
          <p className="text-sm text-steel-graphite">
            Задача вернётся в статус «Ожидает». Причина обязательна и попадёт в аудит (Р-17).
          </p>

          <label className="flex flex-col gap-1 text-sm text-steel-graphite">
            Причина отмены
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              className="rounded-md border border-mist-metal bg-white px-3 py-2 text-sm text-graphite"
            />
          </label>

          {unmarkError && (
            <p role="alert" className="text-sm text-alert">
              {unmarkError}
            </p>
          )}

          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setIsUnmarkOpen(false)}>
              Закрыть
            </Button>
            <Button type="button" onClick={handleUnmark} disabled={isUnmarkPending}>
              {isUnmarkPending ? 'Отмена…' : 'Отменить обработку'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
