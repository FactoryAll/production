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
  const balances = await prisma.stockBalance.findMany({
    where: {
      warehouse: { type: 'PRODUCTION' },
      stockCategory: { in: ['MASS', 'PF'] },
      quantity: { gt: 0 },
    },
    include: { product: true },
    orderBy: { product: { name: 'asc' } },
  });

  return balances.map((balance) => ({
    id: balance.productId,
    code: balance.product.code,
    name: balance.product.name,
    unit: balance.product.unit,
    category: balance.stockCategory,
    available: Number(balance.quantity),
  }));
}
