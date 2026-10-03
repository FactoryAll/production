import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/auth/session';
import { getLandingPath } from '@/lib/auth/landing';

export default async function DashboardPage() {
  const session = await requireSession();
  const roles = session.user.roles.map((ur) => ur.role.code);

  redirect(getLandingPath(roles));
}
