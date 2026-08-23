import { cookies } from 'next/headers';
import { prisma } from '@prodtrack/db';
import { SESSION_COOKIE_NAME } from './constants';

// TODO T-017: заменить на центральную матрицу доступа
export async function requireAdmin(): Promise<{ userId: string }> {
  const cookieStore = cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    throw new Error('Unauthorized');
  }

  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: { include: { roles: { include: { role: true } } } } },
  });

  if (!session || session.expiresAt < new Date()) {
    throw new Error('Unauthorized');
  }

  const isAdmin = session.user.roles.some((ur) => ur.role.code === 'ADM');
  if (!isAdmin) {
    throw new Error('Forbidden');
  }

  return { userId: session.userId };
}
