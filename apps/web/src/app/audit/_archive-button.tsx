'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@prodtrack/ui';
import { archiveOldAuditAction } from './actions';

/**
 * Кнопка «Архивировать старые записи» на экране «Аудит» (Р-16).
 * Доступна только АДМ; ошибка серверного действия показывается пользователю.
 */
export default function ArchiveAuditButton() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleArchive() {
    setMessage(null);
    setError(null);
    setIsPending(true);

    try {
      const result = await archiveOldAuditAction();
      if (result.success) {
        setMessage('Записей переведено в архив: ' + result.archived);
        router.refresh();
      } else {
        setError(result.error ?? 'Не удалось архивировать записи аудита');
      }
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="secondary" onClick={handleArchive} disabled={isPending}>
        {isPending ? 'Архивация…' : 'Архивировать старые записи'}
      </Button>
      {message && (
        <p role="status" className="text-sm text-graphite">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-graphite">
          {error}
        </p>
      )}
    </div>
  );
}
