// Одноразовый бэкфилл смен (T-075): `pnpm db:backfill-shifts [--dry-run]`.
//
// До v2.1.0 справочник смен был шаблонным: все ПЗ ссылались на две строки с датой-заглушкой
// 2000-01-01, поэтому у документа не было даты смены. Скрипт проставляет каждому такому ПЗ
// смену по дате его подтверждения (или создания) и нужному номеру, создавая записи смен.
//
// Идемпотентно: повторный запуск не находит ПЗ с шаблонной сменой и ничего не меняет.

import { PrismaClient } from '@prisma/client';
import { resolveShiftId, shiftDateColumn } from '../src/shifts';

const prisma = new PrismaClient();

/** Дата-заглушка шаблонных смен из сида Фазы 0. */
const TEMPLATE_DATE_KEY = '2000-01-01';

const dryRun = process.argv.includes('--dry-run');

function localDateKey(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

async function main(): Promise<void> {
  const templateDate = shiftDateColumn(TEMPLATE_DATE_KEY);

  const orders = await prisma.productionOrder.findMany({
    where: { shift: { date: templateDate } },
    select: { id: true, shiftId: true, createdAt: true, confirmedAt: true, shift: { select: { number: true } } },
  });

  console.log(
    `ПЗ с шаблонной сменой: ${orders.length}${dryRun ? ' (пробный прогон, изменения не применяются)' : ''}`,
  );

  let moved = 0;
  for (const order of orders) {
    // Дата смены — день, когда ПЗ подтвердили (документ становится рабочим); если подтверждения
    // ещё не было (черновик), берём день создания.
    const source = order.confirmedAt ?? order.createdAt;
    const dateKey = localDateKey(source);
    console.log(`  ПЗ ${order.id.slice(0, 8)}: смена ${order.shift.number} → ${dateKey}`);

    if (dryRun) {
      continue;
    }

    const shiftId = await resolveShiftId(prisma, { dateKey, number: order.shift.number });
    await prisma.productionOrder.update({ where: { id: order.id }, data: { shiftId } });
    moved += 1;
  }

  if (dryRun) {
    console.log('Пробный прогон завершён, изменения не применялись.');
    return;
  }

  // Шаблонные смены больше не используются: помечаем неактивными те, к которым не привязан ни один ПЗ.
  const leftover = await prisma.shift.updateMany({
    where: { date: templateDate, orders: { none: {} } },
    data: { active: false },
  });

  console.log(`ПЗ перенесено на смены по датам: ${moved}`);
  console.log(`Шаблонных смен помечено неактивными: ${leftover.count}`);
}

main()
  .catch((error: unknown) => {
    console.error('Ошибка бэкфилла смен:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
