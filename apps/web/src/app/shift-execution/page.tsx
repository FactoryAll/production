export const dynamic = 'force-dynamic';

import { requireSession } from '@/lib/auth/session';
import { prisma } from '@prodtrack/db';
import { getConsumableStock } from '@/lib/consumable-stock';
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
      facts: {
        include: {
          consumptions: true,
        },
      },
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

/**
 * Что оператор может указать в «Потреблении» (ОПЭ-34, решение владельца 23.10.2026).
 *
 * Предлагается не вся номенклатура, а то, что реально лежит на Производственном складе
 * категориями «Масса» и «ПФ»: оператор ГП потребляет и Массу, и полуфабрикат.
 * Доступное количество отдаётся рядом — оно и попадает подсказкой в поле «Количество».
 */
async function getConsumableProducts() {
  // Правило одно на всё приложение (ОПЭ-44): остатки Производственного склада, Масса и ПФ.
  return getConsumableStock(prisma);
}
