
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  await prisma.productionOrderLineWorkers.deleteMany({ where: { line: { operator: { fullName: { startsWith: 'E2E Operator' } } } } });
  await prisma.productionFact.deleteMany({ where: { line: { operator: { fullName: { startsWith: 'E2E Operator' } } } } });
  await prisma.productionOrderLine.deleteMany({ where: { operator: { fullName: { startsWith: 'E2E Operator' } } } });
  await prisma.productionOrder.deleteMany({ where: { createdBy: { login: { startsWith: 'e2e_' } } } });
  await prisma.productionOrder.deleteMany({ where: { lines: { some: { operator: { fullName: { startsWith: 'E2E Operator' } } } } } });
  await prisma.session.deleteMany({ where: { user: { login: { startsWith: 'e2e_' } } } });
  await prisma.userRole.deleteMany({ where: { user: { login: { startsWith: 'e2e_' } } } });
  await prisma.user.deleteMany({ where: { login: { startsWith: 'e2e_' } } });
  await prisma.employee.deleteMany({ where: { fullName: { startsWith: 'E2E Operator' } } });
  await prisma.product.deleteMany({ where: { code: { startsWith: 'MASS-E2E-' } } });
  await prisma.product.deleteMany({ where: { code: { startsWith: 'GP-E2E-' } } });
  await prisma.$disconnect();
  console.log('cleanup done');
}
main().catch(e=>{console.error(e);process.exit(1)});
