export const dynamic = 'force-dynamic';

import { prisma } from '@prodtrack/db';
import SubstitutionReasonsPage from './_client-page';

export default async function SubstitutionReasonsServerPage() {
  const substitutionReasons = await prisma.substitutionReason.findMany({ orderBy: { code: 'asc' } });
  return <SubstitutionReasonsPage substitutionReasons={substitutionReasons} />;
}
