'use server';

import { requirePermission } from './access';

/**
 * @deprecated Use `requirePermission('nsi:manage')` directly. Kept for compatibility with older tests.
 */
export async function requireAdmin(): Promise<{ userId: string }> {
  const session = await requirePermission('nsi:manage');
  return { userId: session.userId };
}
