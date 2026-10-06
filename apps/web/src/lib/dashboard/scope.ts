// Область видимости дашборда M11 §3 / BR-3: Оператор видит показатели в разрезе своего РЦ,
// остальные роли — сводно. Разделение задано правами: `dashboard:read` есть у НП, КСГП,
// УСГП, С1С и АДМ, `dashboard:read_own` — только у ОПР (M02).

import { hasPermission } from '@prodtrack/contracts';
import { prisma } from '@prodtrack/db';

export type DashboardScope = 'ALL' | 'OWN_WORK_CENTER';

export function dashboardScope(userRoles: string[]): DashboardScope {
  return hasPermission(userRoles, 'dashboard:read') ? 'ALL' : 'OWN_WORK_CENTER';
}

/**
 * РЦ Оператора: строки ПЗ, где он назначен Оператором.
 *
 * Та же область видимости, что в M04 (исполнение смены) и M10 §3 (хронометраж):
 * ПЗ видит только назначенный Оператор РЦ (00 §9, допущение 3).
 */
export async function getOwnWorkCenterIds(employeeId: string): Promise<string[]> {
  const lines = await prisma.productionOrderLine.findMany({
    where: { operatorId: employeeId },
    select: { workCenterId: true },
  });
  return [...new Set(lines.map((line) => line.workCenterId))];
}
