export const dynamic = 'force-dynamic';

import { prisma } from '@prodtrack/db';
import DefectReasonsPage from './_client-page';

export default async function DefectReasonsServerPage() {
  const defectReasons = await prisma.defectReason.findMany({ orderBy: { code: 'asc' } });
  return <DefectReasonsPage defectReasons={defectReasons} />;
}
