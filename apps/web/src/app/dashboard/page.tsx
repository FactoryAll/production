export const dynamic = 'force-dynamic';

import { hasPermission } from '@prodtrack/contracts';
import { AccessDenied } from '@/components/access-denied';
import { checkPageAccess } from '@/lib/auth/page-guard';
import { getOwnDocumentIds } from '@/app/timing/queries';
import { dashboardPeriodRange, parseDashboardPeriod } from '@/lib/dashboard/period';
import {
  getDashboardDocuments,
  getDashboardRevision,
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
  // Оператор видит только свои РЦ и свои документы (M11 §3, BR-3; та же область, что в M04/M10 §3).
  //
  // Если учётная запись Оператора не привязана к сотруднику, список пуст — а не «без ограничений»:
  // пустой массив даёт выборку «ничего», тогда как отсутствие фильтра открыло бы Оператору данные
  // всего предприятия. Так же устроен хронометраж M10.
  const restricted = scope === 'OWN_WORK_CENTER';
  const ownWorkCenterIds = restricted
    ? employeeId
      ? await getOwnWorkCenterIds(employeeId)
      : []
    : undefined;
  const ownDocumentIds = restricted
    ? employeeId
      ? await getOwnDocumentIds(employeeId)
      : []
    : undefined;

  // Перемещения видны только тем, кто вправе их читать: у ОПР права `transfer:read` нет
  // (M02, решение владельца 03.10.2026), поэтому и показатель, и строки списка ему не показываем.
  const canReadTransfers = hasPermission(access.roles, 'transfer:read');

  const [inProduction, produced, transfers, received, durations, documents, revision] =
    await Promise.all([
      getInProduction(now, ownWorkCenterIds),
      getProducedTotals(range, ownWorkCenterIds),
      canReadTransfers ? getInTransferTotals() : Promise.resolve({ count: 0, plannedQuantity: 0 }),
      getReceivedToFinishedGoods(range),
      getStageDurationSummary(range, ownDocumentIds),
      getDashboardDocuments(now, filter, ownWorkCenterIds, canReadTransfers),
      getDashboardRevision(),
    ]);

  return (
    <DashboardPage
      revision={revision}
      canReadTransfers={canReadTransfers}
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
