export const dynamic = 'force-dynamic';

import { prisma } from '@prodtrack/db';
import { hasPermission } from '@prodtrack/contracts';
import { AccessDenied } from '@/components/access-denied';
import { checkPageAccess } from '@/lib/auth/page-guard';

import GpBindingsPage, { type GpBindingRow, type WorkCenterOption } from './_client-page';

/**
 * «НСИ → Привязки ГП»: сводная по всем привязкам изделий (решение владельца 19.11.2026).
 *
 * Зачем экран: привязки приходят из спецификации 1С, но 13 готовых продуктов в выгрузке
 * отсутствуют, а часть позиций может быть устаревшей. Без экрана поправить это нечем —
 * и «сводная с возможностью корректировки» была прямым требованием владельца.
 */
export default async function ServerPage() {
  const access = await checkPageAccess('nsi:manage');
  if (!access.allowed) {
    return (
      <AccessDenied
        action="просмотр и правку привязок изделий"
        allowedRoles={['NP', 'ADM']}
        requiredPermission="nsi:manage"
      />
    );
  }

  const [products, masses, workCenters, lastRun] = await Promise.all([
    prisma.product.findMany({
      where: { category: 'GP' },
      include: {
        massProduct: { select: { code: true, name: true } },
        packagingWorkCenters: { select: { workCenter: { select: { code: true } } } },
      },
      orderBy: { code: 'asc' },
    }),
    prisma.product.findMany({
      where: { category: 'MASS', active: true },
      select: { code: true, name: true },
      orderBy: { code: 'asc' },
    }),
    prisma.workCenter.findMany({
      where: { active: true, producesMass: false },
      select: { code: true, name: true },
      orderBy: { code: 'asc' },
    }),
    prisma.bomImportRun.findFirst({
      orderBy: { startedAt: 'desc' },
      select: { fileName: true, startedAt: true, massBound: true, tubeBound: true },
    }),
  ]);

  const rows: GpBindingRow[] = products.map((product) => ({
    id: product.id,
    code: product.code,
    name: product.name,
    active: product.active,
    massCode: product.massProduct?.code ?? null,
    massName: product.massProduct?.name ?? null,
    massQuantity: product.massQuantity?.toString() ?? null,
    tubeCode: product.tubeProductCode ?? null,
    tubeName: product.tubeProductName ?? null,
    tubeQuantity: product.tubeQuantity?.toString() ?? null,
    packagingCodes: product.packagingWorkCenters.map((item) => item.workCenter.code).sort(),
  }));

  const workCenterOptions: WorkCenterOption[] = workCenters.map((workCenter) => ({
    code: workCenter.code,
    label: `${workCenter.code} — ${workCenter.name}`,
  }));

  const canManage = hasPermission(access.roles, 'nsi:manage');

  return (
    <GpBindingsPage
      rows={rows}
      massOptions={masses.map((mass) => ({ code: mass.code, label: `${mass.code} — ${mass.name}` }))}
      workCenterOptions={workCenterOptions}
      canManage={canManage}
      lastImport={
        lastRun
          ? {
              fileName: lastRun.fileName,
              startedAt: lastRun.startedAt.toISOString(),
              massBound: lastRun.massBound,
              tubeBound: lastRun.tubeBound,
            }
          : null
      }
    />
  );
}
