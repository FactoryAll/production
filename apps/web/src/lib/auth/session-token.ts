'use server';

import { prisma } from '@prodtrack/db';
import type { Session, User, Role } from '@prisma/client';

export type SessionWithUser = Session & {
  user: User & { roles: { role: Pick<Role, 'code'> }[] };
};

export async function getSessionFromToken(token: string | undefined): Promise<SessionWithUser | null> {
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { token },
    include: {
      user: {
        include: {
          roles: {
            include: { role: { select: { code: true } } },
          },
        },
      },
    },
  });

  if (!session || session.expiresAt < new Date()) {
    return null;
  }

  return session as SessionWithUser;
}