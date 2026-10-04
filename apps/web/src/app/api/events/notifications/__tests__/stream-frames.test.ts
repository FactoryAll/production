import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@prodtrack/db', () => ({
  prisma: { notification: { count: vi.fn(), findFirst: vi.fn() } },
}));

import { getSession } from '@/lib/auth/session';
import { prisma } from '@prodtrack/db';
import { NOTIFICATION_STREAM_INTERVAL_MS, NOTIFICATION_STREAM_PING_MS } from '@/lib/events/stream';
import { GET } from '../route';

const decode = (chunk: Uint8Array | undefined) => new TextDecoder().decode(chunk);

describe('SSE-канал: кадры после первого', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    (getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: 'user-1',
      user: { id: 'user-1', roles: [{ role: { code: 'OPR' } }] },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('шлёт keep-alive каждые 15 секунд, а изменения — на каждом опросе', async () => {
    (prisma.notification.count as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    (prisma.notification.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'n-1' });

    const response = await GET();
    const reader = response.body!.getReader();

    // 1) первый кадр — текущее состояние
    const first = await reader.read();
    expect(decode(first.value)).toBe('data: ' + JSON.stringify({ unreadCount: 1, latestId: 'n-1' }) + String.fromCharCode(10, 10));

    // 2) через 15 секунд — служебный кадр
    await vi.advanceTimersByTimeAsync(NOTIFICATION_STREAM_PING_MS);
    const ping = await reader.read();
    expect(decode(ping.value)).toBe(': ping' + String.fromCharCode(10, 10));

    // 3) пришло новое уведомление — в течение интервала опроса клиент получает изменение
    (prisma.notification.count as ReturnType<typeof vi.fn>).mockResolvedValue(2);
    (prisma.notification.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'n-2' });
    await vi.advanceTimersByTimeAsync(NOTIFICATION_STREAM_INTERVAL_MS);
    const changed = await reader.read();
    expect(decode(changed.value)).toContain('"unreadCount":2');
    expect(decode(changed.value)).toContain('n-2');

    await reader.cancel();
  });

  it('не шлёт лишних кадров, пока состояние не изменилось', async () => {
    (prisma.notification.count as ReturnType<typeof vi.fn>).mockResolvedValue(3);
    (prisma.notification.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'n-3' });

    const response = await GET();
    const reader = response.body!.getReader();
    await reader.read(); // первый кадр

    await vi.advanceTimersByTimeAsync(NOTIFICATION_STREAM_INTERVAL_MS * 3);
    const ping = await reader.read();
    // Следующий кадр — именно keep-alive: состояние не менялось, data-кадров нет.
    expect(decode(ping.value)).toBe(': ping' + String.fromCharCode(10, 10));

    await reader.cancel();
  });
});
