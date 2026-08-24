export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@prodtrack/db';
import { RoleCode } from '@prodtrack/contracts';
import { Button } from '@prodtrack/ui';
import { getShiftReportData, type ShiftReportData } from '@/lib/shift-report-service';
import { requireSession } from '@/lib/auth/session';
import ShiftReportClientPage from './_client-page';

interface ShiftReportPageProps {
  params: { orderId: string };
}

export default async function ShiftReportPage({ params }: ShiftReportPageProps) {
  const session = await requireSession();
  const userRoles = session.user.roles.map((ur) => ur.role.code);

  const data = await getShiftReportData(params.orderId, prisma, userRoles, session.user.employeeId);
  if (!data.order) {
    notFound();
  }

  const serializable: SerializableShiftReportData = {
    order: {
      id: data.order.id,
      status: data.order.status,
      completedAt: data.order.completedAt?.toISOString() ?? null,
      shift: {
        id: data.order.shift.id,
        number: data.order.shift.number,
        date: data.order.shift.date.toISOString(),
        start: data.order.shift.start,
        end: data.order.shift.end,
      },
      lines: data.order.lines.map((line) => ({
        id: line.id,
        workCenterId: line.workCenterId,
        workCenter: {
          id: line.workCenter.id,
          code: line.workCenter.code,
          name: line.workCenter.name,
        },
        product: {
          id: line.product.id,
          name: line.product.name,
          unit: line.product.unit,
        },
        plannedQuantity: toNumber(line.plannedQuantity),
      })),
    },
    planVsFact: data.planVsFact,
    outputStructure: data.outputStructure,
    defectsByReason: data.defectsByReason,
    stopsByDuration: data.stopsByDuration,
    consumptionByProduct: data.consumptionByProduct,
    canReadAll: userRoles.includes('production_order:read' as RoleCode) || userRoles.includes('dashboard:read' as RoleCode),
  };

  return (
    <div className="min-h-screen bg-neutral-50 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Link href={`/production-orders/${params.orderId}`}>
              <Button variant="secondary" size="sm">← Назад к ПЗ</Button>
            </Link>
          </div>
          <h1 className="font-sans text-2xl font-semibold text-graphite">
            Отчёт за смену · {data.order.id.slice(0, 8)}
          </h1>
        </div>
        <ShiftReportClientPage data={serializable} />
      </div>
    </div>
  );
}

function toNumber(value: { toNumber: () => number } | number | string): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  return value.toNumber();
}

export interface SerializableShiftReportData {
  order: {
    id: string;
    status: string;
    completedAt: string | null;
    shift: {
      id: string;
      number: number;
      date: string;
      start: string;
      end: string;
    };
    lines: Array<{
      id: string;
      workCenterId: string;
      workCenter: { id: string; code: string; name: string };
      product: { id: string; name: string; unit: string };
      plannedQuantity: number;
    }>;
  };
  planVsFact: ShiftReportData['planVsFact'];
  outputStructure: ShiftReportData['outputStructure'];
  defectsByReason: ShiftReportData['defectsByReason'];
  stopsByDuration: ShiftReportData['stopsByDuration'];
  consumptionByProduct: ShiftReportData['consumptionByProduct'];
  canReadAll: boolean;
}
