import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/auth/session';

export default async function DashboardPage() {
  const session = await requireSession();
  const roles = session.user.roles.map((ur) => ur.role.code);

  if (roles.includes('OPR') && roles.length === 1) {
    redirect('/shift-execution');
  }

  redirect('/production-orders');
}
