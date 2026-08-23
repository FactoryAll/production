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

function mockSession(roleCode: string, expired = false, mustChangePassword = false) {
  (prisma.session.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 's1',
    token: 'tok',
    userId: 'u1',
    expiresAt: new Date(Date.now() + (expired ? -1000 : 1000)),
    user: {
      id: 'u1',
      active: true,
      mustChangePassword,
      passwordHash: 'hashed',
      roles: [{ role: { code: roleCode } }],
    },
  });
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
    mockSession('ADM', true);
    const response = await middleware(buildRequest('/nsi/work-centers'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/login');
  });

  it('allows /dashboard for ADM', async () => {
    mockSession('ADM');
    const response = await middleware(buildRequest('/dashboard', 'session=valid-token'));
    expect(response.status).toBe(200);
  });

  it('allows /dashboard for OPR with dashboard:read_own', async () => {
    mockSession('OPR');
    const response = await middleware(buildRequest('/dashboard', 'session=valid-token'));
    expect(response.status).toBe(200);
  });

  it('redirects logged-in users away from /login', async () => {
    mockSession('ADM');
    const response = await middleware(buildRequest('/login', 'session=valid-token'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/dashboard');
  });

  it('allows /nsi/* for ADM (nsi:manage)', async () => {
    mockSession('ADM');
    const response = await middleware(buildRequest('/nsi/work-centers', 'session=valid-token'));
    expect(response.status).toBe(200);
  });

  it('blocks /nsi/* for OPR (403 redirect)', async () => {
    mockSession('OPR');
    const response = await middleware(buildRequest('/nsi/work-centers', 'session=valid-token'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/forbidden');
  });

  it('attaches x-user-id and x-user-roles headers for valid session', async () => {
    mockSession('ADM');
    const response = await middleware(buildRequest('/dashboard', 'session=valid-token'));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-user-id')).toBe('u1');
    expect(response.headers.get('x-user-roles')).toBe('ADM');
  });

  it('redirects to /change-password when mustChangePassword is true and route is not allowed', async () => {
    mockSession('ADM', false, true);
    const response = await middleware(buildRequest('/dashboard', 'session=valid-token'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/change-password');
  });

  it('allows /change-password when mustChangePassword is true', async () => {
    mockSession('ADM', false, true);
    const response = await middleware(buildRequest('/change-password', 'session=valid-token'));
    expect(response.status).toBe(200);
  });

  it('allows /api/auth/logout when mustChangePassword is true', async () => {
    mockSession('ADM', false, true);
    const response = await middleware(buildRequest('/api/auth/logout', 'session=valid-token'));
    expect(response.status).toBe(200);
  });

  it('allows normal access after password change', async () => {
    mockSession('ADM', false, false);
    const response = await middleware(buildRequest('/dashboard', 'session=valid-token'));
    expect(response.status).toBe(200);
  });
});
