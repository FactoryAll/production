'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@prodtrack/ui';

/**
 * Обновление доски без перезагрузки страницы (решение владельца 31.10.2026).
 *
 * Требования, которые здесь зафиксированы:
 *   1. Опрос каждые 60 секунд через `router.refresh()` — данные обновляются, а фильтры
 *      и прокрутка остаются: они живут в адресе и в DOM, переход никуда не делается.
 *   2. В скрытой вкладке сервер **не дёргаем** (`document.hidden`) — иначе десяток открытых
 *      досок держит базу занятой без пользы.
 *   3. Кнопка «Обновить» — то же обновление по требованию: пользователь не ждёт минуту.
 */
export const AUTO_REFRESH_INTERVAL_MS = 60_000;

export function AutoRefresh({ intervalMs = AUTO_REFRESH_INTERVAL_MS }: { intervalMs?: number }) {
  const router = useRouter();

  React.useEffect(() => {
    const timer = setInterval(() => {
      // Скрытая вкладка — тишина: иначе фоновые вкладки обновляют данные без читателя.
      if (document.hidden) {
        return;
      }
      router.refresh();
    }, intervalMs);

    return () => clearInterval(timer);
  }, [router, intervalMs]);

  return null;
}

/** Кнопка «Обновить» в шапке доски: обновление по требованию, без ожидания опроса. */
export function RefreshButton() {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();

  return (
    <Button
      type="button"
      variant="secondary"
      disabled={isPending}
      onClick={() => startTransition(() => router.refresh())}
    >
      {isPending ? 'Обновляем…' : 'Обновить'}
    </Button>
  );
}
