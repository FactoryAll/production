import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE_NAME } from '@/lib/auth/constants';

export const dynamic = 'force-dynamic';

/**
 * Сессия исчезла, а cookie осталась — штатный случай: администратор сбросил пароль,
 * и все сессии пользователя удалены (ОПЭ-4). Одного погашения cookie мало и одного
 * перехода на /login мало: middleware по наличию cookie уводит с /login на /dashboard,
 * и получается петля `ERR_TOO_MANY_REDIRECTS` (ОПЭ-22, проверено на проде 20.10.2026).
 *
 * Поэтому сначала гасим cookie в ответе, потом отправляем на вход — тогда middleware
 * больше не считает браузер «вошедшим».
 */
export async function GET(request: Request): Promise<NextResponse> {
  const cookieStore = cookies();
  cookieStore.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });

  return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
}
