import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';
import { prisma } from '@prodtrack/db';

vi.mock('@prodtrack/db', () => ({
  prisma: {
    session: {
      findUnique: vi.fn(),
    },
  },
}));

function buildRequest(pathname: string, cookie?: string) {
  return new NextRequest(`http://localhost${pathname}`, cookie ? { headers: { cookie } } : undefined);
}

describe('middleware', () => {
  it('allows public paths without a session', async () => {
    (prisma.session.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const response = await middleware(buildRequest('/login'));
    expect(response.status).toBe(200);
  });

  it('redirects to /login when session is missing', async () => {
    (prisma.session.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const response = await middleware(buildRequest('/dashboard'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/login');
  });

  it('redirects to /login when session is expired', async () => {
    (prisma.session.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 's1',
      token: 'tok',
      userId: 'u1',
      expiresAt: new Date(Date.now() - 1000),
      user: { id: 'u1', active: true, roles: [] },
    });
    const response = await middleware(buildRequest('/nsi/work-centers'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/login');
  });

  it('allows access with a valid session', async () => {
    (prisma.session.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 's1',
      token: 'tok',
      userId: 'u1',
      expiresAt: new Date(Date.now() + 1000),
      user: { id: 'u1', active: true, roles: [{ role: { code: 'ADM' } }] },
    });
    const response = await middleware(buildRequest('/dashboard', 'session=valid-token'));
    expect(response.status).toBe(200);
  });

  it('redirects logged-in users away from /login', async () => {
    (prisma.session.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 's1',
      token: 'tok',
      userId: 'u1',
      expiresAt: new Date(Date.now() + 1000),
      user: { id: 'u1', active: true, roles: [{ role: { code: 'ADM' } }] },
    });
    const response = await middleware(buildRequest('/login', 'session=valid-token'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/dashboard');
  });
});