import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@prodtrack/contracts';
import {
  dashboardStreamFrame,
  dashboardStreamPing,
  isDashboardStreamChanged,
  DASHBOARD_STREAM_INTERVAL_MS,
  DASHBOARD_STREAM_PING_MS,
  type DashboardStreamPayload,
} from '@/lib/dashboard/stream';
import { getDashboardRevision } from '@/lib/dashboard/queries';

export const dynamic = 'force-dynamic';

/**
 * SSE-канал сводного дашборда M11 (tech_stack §5, UC-M11-2).
 *
 * Сервер опрашивает БД и пушит клиенту только изменения — отпечаток состояния данных,
 * который читает дашборд. Клиент сравнивает отпечаток с тем, что было при рендере, и
 * обновляет показатели без перезагрузки страницы (M11 BR-2).
 *
 * Канал отдаёт данные только владельцу сессии с правом просмотра дашборда (M11 §3).
 * Простой канал переживает за счёт keep-alive-комментариев, иначе nginx закрыл бы
 * соединение по своему proxy_read_timeout (по умолчанию 60 с).
 */
export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }
  const roles = session.user.roles.map((ur) => ur.role.code);
  const allowed =
    hasPermission(roles, 'dashboard:read') || hasPermission(roles, 'dashboard:read_own');
  if (!allowed) {
    return new Response('Forbidden', { status: 403 });
  }

  const encoder = new TextEncoder();
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let previous: DashboardStreamPayload | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = async () => {
        if (closed) {
          return;
        }
        const payload: DashboardStreamPayload = { revision: await getDashboardRevision() };

        if (previous && !isDashboardStreamChanged(previous, payload)) {
          return;
        }

        previous = payload;
        controller.enqueue(encoder.encode(dashboardStreamFrame(payload)));
      };

      try {
        await push();
      } catch {
        // Первый кадр не критичен: клиент повторит запрос при переподключении.
      }

      pollTimer = setInterval(() => {
        void push().catch(() => {
          // Ошибка опроса не должна закрывать канал — ждём следующего тика.
        });
      }, DASHBOARD_STREAM_INTERVAL_MS);

      pingTimer = setInterval(() => {
        if (closed) {
          return;
        }
        try {
          controller.enqueue(encoder.encode(dashboardStreamPing()));
        } catch {
          // Соединение уже закрыто — таймеры снимет cancel().
        }
      }, DASHBOARD_STREAM_PING_MS);
    },
    cancel() {
      closed = true;
      if (pollTimer) {
        clearInterval(pollTimer);
      }
      if (pingTimer) {
        clearInterval(pingTimer);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Отключает буферизацию ответа в nginx (иначе кадры копятся в буфере прокси).
      'X-Accel-Buffering': 'no',
    },
  });
}
