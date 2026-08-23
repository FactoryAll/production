export const dynamic = 'force-dynamic';
import { prisma } from '@prodtrack/db';
import WorkCentersPage from './_client-page';

export default async function WorkCentersServerPage() {
  const workCenters = await prisma.workCenter.findMany({ orderBy: { code: 'asc' } });
  return <WorkCentersPage workCenters={workCenters} />;
}