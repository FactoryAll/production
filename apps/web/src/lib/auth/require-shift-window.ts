'use server';

import { isWithinShiftWindow } from './shift-window';
import { requireSession, type SessionWithUser } from './session';

export async function requireShiftWindow(): Promise<SessionWithUser> {
  const session = await requireSession();
  const userRoles = session.user.roles.map((ur) => ur.role.code);

  if (userRoles.includes('OPR') && userRoles.length === 1) {
    const now = new Date();
    if (!isWithinShiftWindow(now)) {
      throw new Error('Вне рабочего времени');
    }
  }

  return session;
}
