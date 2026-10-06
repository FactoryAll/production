export const dynamic = 'force-dynamic';

import { AccessDenied } from '@/components/access-denied';
import { checkPageAccess } from '@/lib/auth/page-guard';
import { getOwnDocumentIds } from '@/app/timing/queries';
import { dashboardPeriodRange, parseDashboardPeriod } from '@/lib/dashboard/period';
import {
  getDashboardDocuments,
  getInProduction,
  getInTransferTotals,
  getProducedTotals,
  getReceivedToFinishedGoods,
  getStageDurationSummary,
} from '@/lib/dashboard/queries';
import { dashboardScope, getOwnWorkCenterIds } from '@/lib/dashboard/scope';

import DashboardPage from './_client-page';
import { parseDocumentStatus, parseDocumentType } from './filters';

interface DashboardServerPageProps {
  searchParams: {
    period?: string;
    type?: string;
    status?: string;
  };
}

export default async function DashboardServerPage({ searchParams }: DashboardServerPageProps) {
  // M11 §3: просмотр дашборда — R у всех ролей, у Оператора — в разрезе своего РЦ.
  const access = await checkPageAccess(['dashboard:read', 'dashboard:read_own']);
  if (!access.allowed) {
    return (
      <AccessDenied
        action="просмотр сводного дашборда"
        allowedRoles={['NP', 'OPR', 'KSGP', 'USGP', 'S1C', 'ADM']}
        requiredPermission="dashboard:read"
      />
    );
  }

  const now = new Date();
  const period = parseDashboardPeriod(searchParams.period);
  const filter = {
    type: parseDocumentType(searchParams.type),
    status: parseDocumentStatus(searchParams.status),
  };
  const range = dashboardPeriodRange(period, now);

  const scope = dashboardScope(access.roles);
  const employeeId = access.session.user.employeeId;
  // Оператор видит только свои РЦ и свои документы (M11 §3, BR-3; та же область, что в M04/M10).
  const ownWorkCenterIds =
    scope === 'OWN_WORK_CENTER' && employeeId ? await getOwnWorkCenterIds(employeeId) : undefined;
  const ownDocumentIds =
    scope === 'OWN_WORK_CENTER' && employeeId ? await getOwnDocumentIds(employeeId) : undefined;

  const [inProduction, produced, transfers, received, durations, documents] = await Promise.all([
    getInProduction(now, ownWorkCenterIds),
    getProducedTotals(range, ownWorkCenterIds),
    getInTransferTotals(),
    getReceivedToFinishedGoods(range),
    getStageDurationSummary(range, ownDocumentIds),
    getDashboardDocuments(now, filter, ownWorkCenterIds),
  ]);

  return (
    <DashboardPage
      period={period}
      filter={filter}
      scope={scope}
      inProduction={inProduction}
      produced={produced}
      transfers={transfers}
      received={received}
      durations={durations}
      documents={documents}
    />
  );
}
