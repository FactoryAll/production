import { prisma } from '@prodtrack/db';
import { requireAnyPermission, requirePermission } from '@/lib/auth/access';

export async function getTransfers() {
  await requireAnyPermission([
    'transfer:create',
    'transfer:update',
    'transfer:receive',
    'transfer:reconcile',
  ]);

  return prisma.goodsTransfer.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      sourceWarehouse: true,
      destinationWarehouse: true,
      lines: {
        include: {
          product: true,
        },
      },
    },
  });
}

export async function getTransferById(id: string) {
  await requireAnyPermission([
    'transfer:create',
    'transfer:update',
    'transfer:receive',
    'transfer:reconcile',
  ]);

  return prisma.goodsTransfer.findUnique({
    where: { id },
    include: {
      sourceWarehouse: true,
      destinationWarehouse: true,
      submittedBy: { select: { id: true, login: true } },
      lines: {
        include: {
          product: true,
          discrepancies: true,
        },
      },
    },
  });
}

export async function getTransferCreateData() {
  await requirePermission('transfer:create');

  const [warehouses, products] = await Promise.all([
    prisma.warehouse.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.product.findMany({ where: { active: true, category: 'GP' }, orderBy: { code: 'asc' } }),
  ]);

  return { warehouses, products };
}
