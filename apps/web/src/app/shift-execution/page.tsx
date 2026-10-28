export const dynamic = 'force-dynamic';

import { requireSession } from '@/lib/auth/session';
import { prisma } from '@prodtrack/db';
import { getConsumableStock } from '@/lib/consumable-stock';
import ShiftExecutionPage from './_client-page';

export default async function ShiftExecutionRootPage() {
  const session = await requireSession();
  const employeeId = session.user.employeeId;

  const [lines, defectReasons, consumableProducts, absenceReasons, workerCandidates] =
    await Promise.all([
      employeeId ? getOperatorLines(employeeId) : Promise.resolve([]),
      getActiveDefectReasons(),
      getConsumableProducts(),
      getActiveAbsenceReasons(),
      getWorkerCandidates(employeeId),
    ]);

  return (
    <ShiftExecutionPage
      lines={lines}
      employeeId={employeeId}
      defectReasons={defectReasons}
      consumableProducts={consumableProducts}
      absenceReasons={absenceReasons}
      workerCandidates={workerCandidates}
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
      // План работников: оператор подтверждает назначенный состав при вводе итога (T-093).
      workerAssignments: { include: { employee: true } },
      facts: {
        include: {
          consumptions: true,
          factWorkers: { include: { absenceReason: true, employee: true } },
        },
      },
    },
    orderBy: [
      { order: { createdAt: 'desc' } },
      { createdAt: 'asc' },
    ],
  });
}

/**
 * Причины неявки для формы состава (T-093, §10 постановки): берутся только действующие —
 * деактивированную причину в новом составе указывать нельзя.
 */
async function getActiveAbsenceReasons() {
  return prisma.absenceReason.findMany({
    where: { active: true },
    orderBy: { name: 'asc' },
    select: { id: true, code: true, name: true },
  });
}

/**
 * Кого оператор может добавить в состав, если назначение не совпало с выходом:
 * действующие сотрудники, отмеченные как «может привлекаться работником» (M01 §4.1).
 * Сам оператор в этот список не попадает — он ведёт итог, а не выходит работником.
 */
async function getWorkerCandidates(operatorEmployeeId: string | null) {
  return prisma.employee.findMany({
    where: {
      active: true,
      canBeWorker: true,
      ...(operatorEmployeeId ? { id: { not: operatorEmployeeId } } : {}),
    },
    orderBy: { fullName: 'asc' },
    select: { id: true, fullName: true, tabNumber: true },
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
