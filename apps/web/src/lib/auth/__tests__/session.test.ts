import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '@prodtrack/db';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createSession, getSession, destroySession, requireSession } from '../session';

vi.mock('@prodtrack/db', () => ({
  prisma: {
    session: {
      create: vi.fn(),
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

function mockCookieStore(values: Record<string, string> = {}) {
  const store = {
    get: vi.fn((name: string) => (values[name] ? { name, value: values[name] } : undefined)),
    set: vi.fn(),
  };
  (cookies as ReturnType<typeof vi.fn>).mockReturnValue(store as unknown as ReturnType<typeof cookies>);
  return store;
}

describe('session', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('createSession creates a session and sets the cookie', async () => {
    const store = mockCookieStore();
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
    (prisma.session.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'session-id', token: 'token', userId: 'user-id', expiresAt });

    const result = await createSession('user-id', 'Mozilla/5.0');

    expect(result.userId).toBe('user-id');
    expect(prisma.session.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-id',
        userAgent: 'Mozilla/5.0',
        expiresAt: expect.any(Date),
      }),
    });
    expect(store.set).toHaveBeenCalledWith('session', expect.any(String), expect.objectContaining({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      expires: expect.any(Date),
    }));
  });

  it('getSession returns the session when token is valid', async () => {
    mockCookieStore({ session: 'valid-token' });
    const user = { id: 'user-id', active: true, roles: [{ role: { code: 'ADM' } }] };
    (prisma.session.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'session-id',
      token: 'valid-token',
      userId: 'user-id',
      expiresAt: new Date(Date.now() + 1000),
      user,
    });

    const session = await getSession();

    expect(session).toBeTruthy();
    expect(session?.userId).toBe('user-id');
    expect(session?.user).toEqual(user);
  });

  it('getSession returns null when session is expired', async () => {
    mockCookieStore({ session: 'expired-token' });
    (prisma.session.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'session-id',
      token: 'expired-token',
      userId: 'user-id',
      expiresAt: new Date(Date.now() - 1000),
      user: { id: 'user-id', active: true, roles: [] },
    });

    const session = await getSession();

    expect(session).toBeNull();
  });

  // ОПЭ-22 (проверено на проде 20.10.2026): после сброса пароля сессии удаляются (ОПЭ-4),
  // и обновление страницы падало в «Application error: a server-side exception» с digest.
  // Правильное поведение — увести на экран входа.
  it('без сессии уводит на /login, а не бросает исключение', async () => {
    mockCookieStore({ session: 'dead-token' });
    (prisma.session.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    vi.mocked(redirect).mockImplementation(() => {
      throw new Error('NEXT_REDIRECT');
    });

    await expect(requireSession()).rejects.toThrow('NEXT_REDIRECT');
    // Не «/login» напрямую: middleware по живой cookie увёл бы обратно на /dashboard (петля).
    expect(redirect).toHaveBeenCalledWith('/api/auth/session-expired');
  });

  it('destroySession deletes the session and clears the cookie', async () => {
    const store = mockCookieStore({ session: 'token' });
    (prisma.session.deleteMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });

    await destroySession();

    expect(prisma.session.deleteMany).toHaveBeenCalledWith({ where: { token: 'token' } });
    expect(store.set).toHaveBeenCalledWith('session', '', expect.objectContaining({ maxAge: 0, path: '/' }));
  });
});
