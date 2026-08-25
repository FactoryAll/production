const { PrismaClient } = require('/app/node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/.prisma/client/index.js');
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUnique({
    where: { login: 'admin' },
    include: { roles: { include: { role: true } } },
  });
  console.log('User found:', !!user);
  console.log('Roles count:', user?.roles?.length ?? 0);
  console.log('Role codes:', user?.roles?.map(r => r.role?.code) ?? []);
}

main().catch(console.error).finally(() => prisma.$disconnect());
