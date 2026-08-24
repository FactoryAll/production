export const dynamic = 'force-dynamic';

import { requireSession } from '@/lib/auth/session';
import { prisma } from '@prodtrack/db';
import ShiftExecutionPage from './_client-page';

export default async function ShiftExecutionRootPage() {
  const session = await requireSession();
  const employeeId = session.user.employeeId;

  const [lines, defectReasons, consumableProducts] = await Promise.all([
    employeeId ? getOperatorLines(employeeId) : Promise.resolve([]),
    getActiveDefectReasons(),
    getConsumableProducts(),
  ]);

  return (
    <ShiftExecutionPage
      lines={lines}
      employeeId={employeeId}
      defectReasons={defectReasons}
      consumableProducts={consumableProducts}
    />
  );
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

async function getActiveDefectReasons() {
  return prisma.defectReason.findMany({
    where: { active: true },
    orderBy: { name: 'asc' },
  });
}

async function getConsumableProducts() {
  return prisma.product.findMany({
    where: {
      active: true,
      category: {
        in: ['MASS', 'GP'],
      },
    },
    orderBy: { name: 'asc' },
  });
}
