import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '../route';
import { cookies } from 'next/headers';

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

function mockCookieStore(values: Record<string, string> = {}) {
  const store = {
    get: vi.fn((name: string) => (values[name] ? { name, value: values[name] } : undefined)),
    set: vi.fn(),
  };
  (cookies as ReturnType<typeof vi.fn>).mockReturnValue(store as unknown as ReturnType<typeof cookies>);
  return store;
}

describe('session-expired route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ОПЭ-22: cookie жива, а сессии в базе нет (сброс пароля удалил её). Гасим cookie и ведём
  // на вход — иначе middleware по cookie уводит с /login обратно на /dashboard (петля).
  it('гасит cookie сессии и ведёт на /login', async () => {
    const store = mockCookieStore({ session: 'dead-token' });

    // За nginx и в контейнере request.url несёт внутренний адрес, и браузер получал
    // `https://0.0.0.0:3000/login` (ERR_ADDRESS_INVALID). Адрес обязан собираться из Host.
    const request = new Request('http://0.0.0.0:3000/dashboard', {
      headers: { host: 'prodtracker.factoryall.ru', 'x-forwarded-proto': 'https' },
    });
    const response = await GET(request);

    expect(store.set).toHaveBeenCalledWith('session', '', expect.objectContaining({ maxAge: 0, path: '/' }));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://prodtracker.factoryall.ru/login');
  });

  it('работает и когда cookie уже нет', async () => {
    const store = mockCookieStore({});

    const response = await GET(new Request('http://localhost/dashboard'));

    expect(store.set).toHaveBeenCalledWith('session', '', expect.objectContaining({ maxAge: 0 }));
    expect(response.status).toBe(303);
  });
});
