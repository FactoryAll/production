import { prisma } from '@prodtrack/db';
import { getSession } from '@/lib/auth/session';
import {
  isNotificationStreamChanged,
  NOTIFICATION_STREAM_INTERVAL_MS,
  notificationStreamFrame,
  type NotificationStreamPayload,
} from '@/lib/events/stream';

export const dynamic = 'force-dynamic';

/**
 * SSE-канал центра уведомлений M09 (tech_stack.md §5).
 *
 * Сервер опрашивает БД и пушит клиенту только изменения (счётчик непрочитанных и
 * идентификатор последнего уведомления). Канал отдаёт данные только владельцу
 * сессии — уведомления пользователя никому больше не видны (M09 BR-5).
 */
export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }

  const recipientId = session.userId;
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
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

      timer = setInterval(() => {
        void push().catch(() => {
          // Ошибка опроса не должна закрывать канал — ждём следующего тика.
        });
      }, NOTIFICATION_STREAM_INTERVAL_MS);
    },
    cancel() {
      closed = true;
      if (timer) {
        clearInterval(timer);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
