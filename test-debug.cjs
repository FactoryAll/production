const { PrismaClient } = require('/app/node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/.prisma/client/index.js');
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUnique({
    where: { login: 'admin' },
    include: { roles: { include: { role: true } } },
  });

  console.log('User:', user?.login);
  console.log('Roles:', JSON.stringify(user?.roles));

  const userRoles = user?.roles?.map((ur) => ur.role?.code) ?? [];
  console.log('userRoles:', userRoles);

  // Simulate writeAudit logic
  const { getAttributeRole, ROLE_PERMISSIONS } = require('/app/packages/contracts/dist/access.js');
  console.log('ROLE_PERMISSIONS ADM:', ROLE_PERMISSIONS['ADM']?.includes('dashboard:read'));
  const attributedRole = getAttributeRole(userRoles, 'dashboard:read');
  console.log('attributedRole:', attributedRole);
}

main().catch(console.error).finally(() => prisma.$disconnect());
