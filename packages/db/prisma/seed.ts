import { PrismaClient, RoleCode } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const WORK_CENTERS = [
  { code: '01', name: '01.Реактор', producesMass: true },
  { code: '02', name: '02.Реактор', producesMass: true },
  { code: '03', name: '03.Фасовка', producesMass: false },
  { code: '04', name: '04.Фасовка', producesMass: false },
  { code: '05', name: '05.Упаковка', producesMass: false },
  { code: '06', name: '06.Упаковка', producesMass: false },
  { code: '07', name: '07.Маркировка', producesMass: false },
  { code: '08', name: '08.Маркировка', producesMass: false },
  { code: '09', name: '09.Контроль', producesMass: false },
  { code: '10', name: '10.Контроль', producesMass: false },
  { code: '11', name: '11.Ручн налив №3', producesMass: false },
  { code: '12', name: '12.Ручн налив №4', producesMass: false },
];

const WAREHOUSES = [
  { name: 'Производственный', type: 'PRODUCTION' as const, description: 'Склад сырья и материалов' },
  { name: 'Склад ГП', type: 'FINISHED_GOODS' as const, description: 'Склад готовой продукции' },
];

const SUBSTITUTION_REASONS = [
  { code: 'ILLNESS', name: 'Болезнь' },
  { code: 'NO_SHOW', name: 'Неявка' },
  { code: 'LEFT_SHIFT', name: 'Ушел смену' },
  { code: 'OTHER', name: 'Иное' },
];

const DEFECT_REASONS = [
  { code: 'DEFECT_A', name: 'Брак A' },
  { code: 'DEFECT_B', name: 'Брак B' },
  { code: 'DEFECT_C', name: 'Брак C' },
];

const SHIFTS = [
  { number: 1, start: '08:00', end: '20:00' },
  { number: 2, start: '20:00', end: '08:00' },
];

const ROLES = [
  { code: 'NP', name: 'Начальник производства' },
  { code: 'OPR', name: 'Оператор' },
  { code: 'KSGP', name: 'Кладовщик склада ГП' },
  { code: 'USGP', name: 'УСГП' },
  { code: 'S1C', name: 'Специалист 1С' },
  { code: 'ADM', name: 'Администратор' },
];

const ADMIN_LOGIN = 'admin';
const ADMIN_PASSWORD = 'admin123';

// Reference/template shift date used only for seed idempotency.
const SHIFT_SEED_DATE = new Date('2000-01-01');

async function seedWorkCenters() {
  await Promise.all(
    WORK_CENTERS.map(({ code, name, producesMass }) =>
      prisma.workCenter.upsert({
        where: { code },
        update: { name, producesMass, active: true },
        create: { code, name, producesMass, active: true },
      }),
    ),
  );
}

async function seedWarehouses() {
  for (const { name, type, description } of WAREHOUSES) {
    const existing = await prisma.warehouse.findFirst({ where: { name } });
    if (existing) {
      await prisma.warehouse.update({
        where: { id: existing.id },
        data: { type, description, active: true },
      });
    } else {
      await prisma.warehouse.create({
        data: { name, type, description, active: true },
      });
    }
  }
}

async function seedSubstitutionReasons() {
  await Promise.all(
    SUBSTITUTION_REASONS.map(({ code, name }) =>
      prisma.substitutionReason.upsert({
        where: { code },
        update: { name, active: true },
        create: { code, name, active: true },
      }),
    ),
  );
}

async function seedDefectReasons() {
  await Promise.all(
    DEFECT_REASONS.map(({ code, name }) =>
      prisma.defectReason.upsert({
        where: { code },
        update: { name, active: true },
        create: { code, name, active: true },
      }),
    ),
  );
}

async function seedShifts() {
  await Promise.all(
    SHIFTS.map(({ number, start, end }) =>
      prisma.shift.upsert({
        where: {
          number_date: {
            number,
            date: SHIFT_SEED_DATE,
          },
        },
        update: { start, end, active: true },
        create: { number, date: SHIFT_SEED_DATE, start, end, active: true },
      }),
    ),
  );
}



async function seedRoles() {
  await Promise.all(
    ROLES.map(({ code, name }) =>
      prisma.role.upsert({
        where: { code: code as RoleCode },
        update: { name },
        create: { code: code as RoleCode, name },
      }),
    ),
  );
}

async function seedAdmin() {
  const adminRole = await prisma.role.findUnique({ where: { code: 'ADM' } });
  if (!adminRole) return;

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  await prisma.user.upsert({
    where: { login: ADMIN_LOGIN },
    update: {
      passwordHash,
      active: true,
      mustChangePassword: false,
    },
    create: {
      login: ADMIN_LOGIN,
      passwordHash,
      active: true,
      mustChangePassword: false,
      roles: { create: { roleId: adminRole.id } },
    },
  });
}

async function main() {
  await seedWorkCenters();
  await seedWarehouses();
  await seedSubstitutionReasons();
  await seedDefectReasons();
  await seedShifts();
  await seedRoles();
  await seedAdmin();
  console.log('Reference data seeded successfully.');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });