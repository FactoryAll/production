import { prisma } from '@prodtrack/db';
import { getSession } from '@/lib/auth/session';
import {
  isNotificationStreamChanged,
  NOTIFICATION_STREAM_INTERVAL_MS,
  NOTIFICATION_STREAM_PING_MS,
  notificationStreamFrame,
  notificationStreamPing,
  type NotificationStreamPayload,
} from '@/lib/events/stream';

export const dynamic = 'force-dynamic';

/**
 * SSE-канал центра уведомлений M09 (tech_stack.md §5).
 *
 * Сервер опрашивает БД и пушит клиенту только изменения (счётчик непрочитанных и
 * идентификатор последнего уведомления). Канал отдаёт данные только владельцу
 * сессии — уведомления пользователя никому больше не видны (M09 BR-5).
 *
 * Простой канал переживает за счёт keep-alive-комментариев (см.
 * NOTIFICATION_STREAM_PING_MS), иначе nginx закрыл бы соединение по своему
 * proxy_read_timeout (по умолчанию 60 с).
 */
export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }

  const recipientId = session.userId;
  const encoder = new TextEncoder();
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let previous: NotificationStreamPayload | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = async () => {
        if (closed) {
          return;
        }
        const [unreadCount, latest] = await Promise.all([
          prisma.notification.count({ where: { recipientId, readAt: null } }),
          prisma.notification.findFirst({
            where: { recipientId },
            orderBy: { createdAt: 'desc' },
            select: { id: true },
          }),
        ]);

        const payload: NotificationStreamPayload = {
          unreadCount,
          latestId: latest?.id ?? null,
        };

        if (previous && !isNotificationStreamChanged(previous, payload)) {
          return;
        }

        previous = payload;
        controller.enqueue(encoder.encode(notificationStreamFrame(payload)));
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
      }, NOTIFICATION_STREAM_INTERVAL_MS);

      pingTimer = setInterval(() => {
        if (closed) {
          return;
        }
        try {
          controller.enqueue(encoder.encode(notificationStreamPing()));
        } catch {
          // Соединение уже закрыто — таймеры снимет cancel().
        }
      }, NOTIFICATION_STREAM_PING_MS);
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
