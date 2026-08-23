'use server';

import { cookies } from 'next/headers';
import { randomBytes } from 'crypto';
import { prisma } from '@prodtrack/db';
import type { Session } from '@prisma/client';
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from './constants';
import { getSessionFromToken, type SessionWithUser } from './session-token';

export type { SessionWithUser };

function buildCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    expires: expiresAt,
  };
}

export async function createSession(userId: string, userAgent?: string): Promise<Session> {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const session = await prisma.session.create({
    data: { token, userId, userAgent: userAgent ?? null, expiresAt },
  });
  cookies().set(SESSION_COOKIE_NAME, token, buildCookieOptions(expiresAt));
  return session;
}

export async function getSession(): Promise<SessionWithUser | null> {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value;
  return getSessionFromToken(token);
}

export async function destroySession(): Promise<void> {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { token } });
  }
  cookies().set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 0,
  });
}

export async function requireSession(): Promise<SessionWithUser> {
  const session = await getSession();
  if (!session) {
    throw new Error('Unauthorized');
  }
  return session;
}
