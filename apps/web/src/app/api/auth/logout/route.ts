import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { AuditAction, prisma, writeAudit } from '@prodtrack/db';
import { SESSION_COOKIE_NAME } from '@/lib/auth/constants';
import { getSessionFromToken } from '@/lib/auth/session-token';

export async function POST(request: Request): Promise<NextResponse> {
  const cookieStore = cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    const session = await getSessionFromToken(token);
    if (session) {
      const userRoles = session.user.roles.map((ur) => ur.role.code);
      await writeAudit(prisma, {
        action: AuditAction.LOGOUT,
        objectType: 'User',
        objectId: session.userId,
        userId: session.userId,
        userRoles,
        permission: 'dashboard:read',
      });
    }
    await prisma.session.deleteMany({ where: { token } });
  }

  cookieStore.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });

  return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
}
