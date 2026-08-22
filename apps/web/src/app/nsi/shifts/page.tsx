export const dynamic = 'force-dynamic';

import { prisma } from '@prodtrack/db';
import ShiftsPage from './_client-page';

export default async function ShiftsServerPage() {
  const shifts = await prisma.shift.findMany({ orderBy: [{ date: 'desc' }, { number: 'asc' }] });
  return <ShiftsPage shifts={shifts} />;
}
