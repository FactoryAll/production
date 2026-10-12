import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';

function buildRequest(pathname: string, cookie?: string, method = 'GET') {
  return new NextRequest(`http://localhost${pathname}`, { method, headers: cookie ? { cookie } : undefined });
}

describe('middleware', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('allows public paths without a session', async () => {
    const response = await middleware(buildRequest('/login'));
    expect(response.status).toBe(200);
  });

  it('redirects to /login when session cookie is missing on protected route', async () => {
    const response = await middleware(buildRequest('/dashboard'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/login');
  });

  it('allows protected route when session cookie is present', async () => {
    const response = await middleware(buildRequest('/dashboard', 'session=valid-token'));
    expect(response.status).toBe(200);
  });

  it('redirects logged-in users away from /login', async () => {
    const response = await middleware(buildRequest('/login', 'session=valid-token'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/dashboard');
  });

  it('allows /nsi/* GET when session cookie is present', async () => {
    const response = await middleware(buildRequest('/nsi/work-centers', 'session=valid-token'));
    expect(response.status).toBe(200);
  });

  it('allows /stock when session cookie is present', async () => {
    const response = await middleware(buildRequest('/stock', 'session=valid-token'));
    expect(response.status).toBe(200);
  });

  it('allows /shift-reports when session cookie is present', async () => {
    const response = await middleware(buildRequest('/shift-reports/po-1', 'session=valid-token'));
    expect(response.status).toBe(200);
  });

  it('redirects unauthenticated user from /shift-reports to /login', async () => {
    const response = await middleware(buildRequest('/shift-reports/po-1'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/login');
  });

  it('allows /nsi index read when session cookie is present', async () => {
    const response = await middleware(buildRequest('/nsi', 'session=valid-token'));
    expect(response.status).toBe(200);
  });

  it('allows static Next.js internals without session', async () => {
    const response = await middleware(buildRequest('/_next/static/chunk.js'));
    expect(response.status).toBe(200);
  });

  it('отдаёт иконку сайта без сессии', async () => {
    // Иконку (app/icon.svg → /icon.svg) запрашивает и браузер на экране входа, где сессии нет.
    const icon = await middleware(buildRequest('/icon.svg'));
    expect(icon.status).toBe(200);

    // Запасные формы того же ресурса — на случай, если Next отдаст его без расширения.
    expect((await middleware(buildRequest('/icon'))).status).toBe(200);
  });
});
