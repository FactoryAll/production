export const dynamic = 'force-dynamic';

import { requireSession } from '@/lib/auth/session';
import { prisma } from '@prodtrack/db';
import ShiftExecutionPage from './_client-page';

export default async function ShiftExecutionRootPage() {
  const session = await requireSession();
  const userRoles = session.user.roles.map((ur) => ur.role.code);
  const employeeId = session.user.employeeId;

  let lines: Awaited<ReturnType<typeof getOperatorLines>> = [];
  if (employeeId) {
    lines = await getOperatorLines(employeeId);
  }

  return <ShiftExecutionPage lines={lines} employeeId={employeeId} userRoles={userRoles} />;
}

async function getOperatorLines(employeeId: string) {
  return prisma.productionOrderLine.findMany({
    where: {
      operatorId: employeeId,
      order: {
        status: {
          in: ['CONFIRMED', 'IN_PROGRESS'],
        },
      },
    },
    include: {
      order: {
        include: {
          shift: true,
        },
      },
      workCenter: true,
      product: true,
    },
    orderBy: [
      { order: { createdAt: 'desc' } },
      { createdAt: 'asc' },
    ],
  });
}
