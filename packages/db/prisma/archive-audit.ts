// CLI архивации аудита (Р-16): `pnpm db:archive-audit`.
//
// Идемпотентно: повторный запуск ничего не меняет. Предназначен для запуска
// по расписанию (cron) на VPS, а также доступен АДМ кнопкой на экране «Аудит».

import { PrismaClient } from '@prisma/client';
import { archiveOldAuditRecords, AUDIT_RETENTION_MONTHS } from '../src/audit-archive';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const archived = await archiveOldAuditRecords(prisma);
  console.log(
    'Аудит: архив старше ' + AUDIT_RETENTION_MONTHS + ' мес. — записей переведено в архив: ' + archived,
  );
}

main()
  .catch((error: unknown) => {
    console.error('Ошибка архивации аудита:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
