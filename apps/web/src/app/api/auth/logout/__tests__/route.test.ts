import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '../route';
import { prisma } from '@prodtrack/db';
import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/auth/session-token';

vi.mock('@prodtrack/db', () => ({
  prisma: {
    session: { deleteMany: vi.fn() },
    auditRecord: { create: vi.fn() },
  },
  AuditAction: { LOGOUT: 'LOGOUT' },
  writeAudit: vi.fn(async (tx, input) => tx.auditRecord.create({ data: input })),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

vi.mock('@/lib/auth/session-token', () => ({
  getSessionFromToken: vi.fn(),
}));

function mockCookieStore(values: Record<string, string> = {}) {
  const store = {
    get: vi.fn((name: string) => (values[name] ? { name, value: values[name] } : undefined)),
    set: vi.fn(),
  };
  (cookies as ReturnType<typeof vi.fn>).mockReturnValue(store as unknown as ReturnType<typeof cookies>);
  return store;
}

describe('logout route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes session, clears cookie and redirects to /login', async () => {
    const store = mockCookieStore({ session: 'token' });
    (getSessionFromToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: 'user-1',
      user: { id: 'user-1', active: true, roles: [] },
    });
    (prisma.session.deleteMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });

    const response = await POST(new Request('http://localhost/api/auth/logout', { method: 'POST' }));

    expect(prisma.session.deleteMany).toHaveBeenCalledWith({ where: { token: 'token' } });
    expect(prisma.auditRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'LOGOUT', objectType: 'User', objectId: 'user-1', userId: 'user-1' }),
    });
    expect(store.set).toHaveBeenCalledWith('session', '', expect.objectContaining({ maxAge: 0, path: '/' }));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('http://localhost/login');
  });

  it('still clears cookie when no session exists', async () => {
    const store = mockCookieStore({});
    (getSessionFromToken as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const response = await POST(new Request('http://localhost/api/auth/logout', { method: 'POST' }));

    expect(prisma.session.deleteMany).not.toHaveBeenCalled();
    expect(store.set).toHaveBeenCalledWith('session', '', expect.objectContaining({ maxAge: 0, path: '/' }));
    expect(response.status).toBe(303);
  });
});