import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/session', () => ({
  getSession: vi.fn(),
}));

vi.mock('@prodtrack/db', () => ({
  prisma: {
    notification: { count: vi.fn(), findFirst: vi.fn() },
  },
}));

import { getSession } from '@/lib/auth/session';
import { prisma } from '@prodtrack/db';
import { GET } from '../route';

async function readFirstChunk(response: Response): Promise<string> {
  const reader = response.body!.getReader();
  const { value } = await reader.read();
  const text = new TextDecoder().decode(value);
  await reader.cancel();
  return text;
}

describe('SSE-канал центра уведомлений (M09 T-045)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('без сессии отвечает 401 — уведомления видны только владельцу (BR-5)', async () => {
    (getSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it('с сессией отдаёт поток и первый кадр с состоянием пользователя', async () => {
    (getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: 'user-1',
      user: { id: 'user-1', roles: [{ role: { code: 'KSGP' } }] },
    });
    (prisma.notification.count as ReturnType<typeof vi.fn>).mockResolvedValue(2);
    (prisma.notification.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'n-5' });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/event-stream');
    expect(response.headers.get('X-Accel-Buffering')).toBe('no');

    const chunk = await readFirstChunk(response);
    expect(chunk).toBe('data: ' + JSON.stringify({ unreadCount: 2, latestId: 'n-5' }) + String.fromCharCode(10) + String.fromCharCode(10));

    expect(prisma.notification.count).toHaveBeenCalledWith({
      where: { recipientId: 'user-1', readAt: null },
    });
  });

  it('первый кадр пустого списка: счётчик 0 и отсутствие последнего уведомления', async () => {
    (getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: 'user-2',
      user: { id: 'user-2', roles: [{ role: { code: 'NP' } }] },
    });
    (prisma.notification.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    (prisma.notification.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const response = await GET();
    const chunk = await readFirstChunk(response);

    expect(chunk).toBe('data: ' + JSON.stringify({ unreadCount: 0, latestId: null }) + String.fromCharCode(10) + String.fromCharCode(10));
  });
});
