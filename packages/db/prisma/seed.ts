import { PrismaClient, RoleCode } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const WORK_CENTERS = [
  { code: '01', name: '01.Реактор' },
  { code: '02', name: '02.Миксер' },
  { code: '03', name: '03.Тубировка крем' },
  { code: '04', name: '04.Тубировка паста' },
  { code: '05', name: '05.Линия вязк.прод' },
  { code: '06', name: '06.Линия жидк.прод' },
  { code: '07', name: '07.П/авт вязк.прод' },
  { code: '08', name: '08.П/авт жидк.прод' },
  { code: '09', name: '09.Ручн налив №1' },
  { code: '10', name: '10.Ручн налив №2' },
  { code: '11', name: '11.Ручн налив №3' },
  { code: '12', name: '12.Ручн налив №4' },
];

function producesMassByCode(code: string): boolean {
  return code === '01' || code === '02';
}

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

export const ROLES = [
  { code: 'NP', name: 'Начальник производства' },
  { code: 'OPR', name: 'Оператор' },
  { code: 'KSGP', name: 'Кладовщик склада ГП' },
  { code: 'USGP', name: 'УСГП' },
  { code: 'S1C', name: 'Специалист 1С' },
  { code: 'ADM', name: 'Администратор' },
];

const ADMIN_LOGIN = 'admin';
const ADMIN_PASSWORD = 'admin123';

export const TEST_MULTI_ROLE_LOGIN = 'test_multi_role';
export const TEST_MULTI_ROLE_PASSWORD = 'test1234';
export const TEST_MULTI_ROLE_ROLES: RoleCode[] = ['NP', 'OPR'];

const TEST_FIRST_LOGIN_LOGIN = 'test_first_login';
const TEST_FIRST_LOGIN_PASSWORD = 'temp1234';

export const TEST_OPR_SHIFT_LOGIN = 'test_opr_shift';
export const TEST_OPR_SHIFT_PASSWORD = 'opr12345';

export const TEST_S1C_LOGIN = 'test_s1c';
export const TEST_S1C_PASSWORD = 's1c12345';

export const PERMISSIONS = [
  { code: 'production_order:create', action: 'Создание производственного задания' },
  { code: 'production_order:update', action: 'Изменение производственного задания' },
  { code: 'production_order:confirm', action: 'Подтверждение производственного задания' },
  { code: 'production_order:read', action: 'Чтение производственных заданий' },
  { code: 'production_order:read_own', action: 'Чтение своего РЦ в ПЗ' },
  { code: 'production_order:accept', action: 'Подтверждение получения ПЗ' },
  { code: 'production_order:report', action: 'Внесение итога смены' },
  { code: 'transfer:create', action: 'Создание перемещения' },
  { code: 'transfer:update', action: 'Изменение перемещения' },
  { code: 'transfer:receive', action: 'Приёмка перемещения' },
  { code: 'transfer:reconcile', action: 'Согласование расхождений' },
  { code: 'stock:read', action: 'Просмотр остатков' },
  { code: 'shift_report:read', action: 'Просмотр отчётов смены' },
  { code: 'dashboard:read', action: 'Просмотр дашборда' },
  { code: 'dashboard:read_own', action: 'Просмотр своего дашборда' },
  { code: 'audit:read', action: 'Просмотр аудита' },
  { code: 'onec:read', action: 'Просмотр данных для 1С' },
  { code: 'onec:process', action: 'Отметка обработано в 1С' },
  { code: 'nsi:manage', action: 'Управление НСИ' },
  { code: 'users:manage', action: 'Управление пользователями' },
  { code: 'roles:manage', action: 'Управление ролями' },
];

export const ROLE_PERMISSION_MAP: Record<RoleCode, string[]> = {
  NP: [
    'production_order:create',
    'production_order:update',
    'production_order:confirm',
    'production_order:read',
    'transfer:create',
    'transfer:update',
    'stock:read',
    'shift_report:read',
    'dashboard:read',
    'audit:read',
  ],
  OPR: [
    'production_order:read_own',
    'production_order:accept',
    'production_order:report',
    'production_order:confirm',
    'stock:read',
    'dashboard:read_own',
  ],
  KSGP: [
    'transfer:receive',
    'transfer:reconcile',
    'stock:read',
    'dashboard:read',
  ],
  USGP: [
    'transfer:reconcile',
    'stock:read',
    'dashboard:read',
  ],
  S1C: [
    'onec:read',
    'onec:process',
    'stock:read',
    'dashboard:read',
  ],
  ADM: PERMISSIONS.map(({ code }) => code),
};


// Reference/template shift date used only for seed idempotency.
const SHIFT_SEED_DATE = new Date('2000-01-01');

async function seedWorkCenters() {
  await Promise.all(
    WORK_CENTERS.map(({ code, name }) =>
      prisma.workCenter.upsert({
        where: { code },
        update: { name, producesMass: producesMassByCode(code), active: true },
        create: { code, name, producesMass: producesMassByCode(code), active: true },
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



async function seedPermissions() {
  await Promise.all(
    PERMISSIONS.map(({ code, action }) =>
      prisma.permission.upsert({
        where: { code },
        update: { action },
        create: { code, action },
      }),
    ),
  );

  return prisma.permission.findMany();
}

async function seedRoles() {
  const permissions = await seedPermissions();
  const permissionByCode = Object.fromEntries(permissions.map((p) => [p.code, p.id]));

  await Promise.all(
    ROLES.map(({ code, name }) =>
      prisma.role.upsert({
        where: { code: code as RoleCode },
        update: { name },
        create: { code: code as RoleCode, name },
      }),
    ),
  );

  for (const { code } of ROLES) {
    const permissionIds = ROLE_PERMISSION_MAP[code as RoleCode]
      .map((permissionCode) => permissionByCode[permissionCode])
      .filter(Boolean);
    await prisma.role.update({
      where: { code: code as RoleCode },
      data: {
        permissions: { set: permissionIds.map((id) => ({ id })) },
      },
    });
  }
}

async function seedMultiRoleUser() {
  const roles = await prisma.role.findMany({
    where: { code: { in: TEST_MULTI_ROLE_ROLES } },
  });

  if (roles.length === 0) return;

  const passwordHash = await bcrypt.hash(TEST_MULTI_ROLE_PASSWORD, 10);
  await prisma.user.upsert({
    where: { login: TEST_MULTI_ROLE_LOGIN },
    update: {
      passwordHash,
      active: true,
      mustChangePassword: false,
    },
    create: {
      login: TEST_MULTI_ROLE_LOGIN,
      passwordHash,
      active: true,
      mustChangePassword: false,
      roles: { create: roles.map((role) => ({ roleId: role.id })) },
    },
  });
}

async function seedFirstLoginUser() {
  const role = await prisma.role.findUnique({ where: { code: 'OPR' } });
  if (!role) return;

  const passwordHash = await bcrypt.hash(TEST_FIRST_LOGIN_PASSWORD, 10);
  await prisma.user.upsert({
    where: { login: TEST_FIRST_LOGIN_LOGIN },
    update: {
      passwordHash,
      active: true,
      mustChangePassword: true,
    },
    create: {
      login: TEST_FIRST_LOGIN_LOGIN,
      passwordHash,
      active: true,
      mustChangePassword: true,
      roles: { create: [{ roleId: role.id }] },
    },
  });
}

async function seedOprShiftUser() {
  const role = await prisma.role.findUnique({ where: { code: 'OPR' } });
  if (!role) return;

  const passwordHash = await bcrypt.hash(TEST_OPR_SHIFT_PASSWORD, 10);
  await prisma.user.upsert({
    where: { login: TEST_OPR_SHIFT_LOGIN },
    update: {
      passwordHash,
      active: true,
      mustChangePassword: false,
    },
    create: {
      login: TEST_OPR_SHIFT_LOGIN,
      passwordHash,
      active: true,
      mustChangePassword: false,
      roles: { create: [{ roleId: role.id }] },
    },
  });
}

async function seedS1cUser() {
  const role = await prisma.role.findUnique({ where: { code: 'S1C' } });
  if (!role) return;

  const passwordHash = await bcrypt.hash(TEST_S1C_PASSWORD, 10);
  await prisma.user.upsert({
    where: { login: TEST_S1C_LOGIN },
    update: {
      passwordHash,
      active: true,
      mustChangePassword: false,
    },
    create: {
      login: TEST_S1C_LOGIN,
      passwordHash,
      active: true,
      mustChangePassword: false,
      roles: { create: [{ roleId: role.id }] },
    },
  });
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
  await seedMultiRoleUser();
  await seedFirstLoginUser();
  await seedOprShiftUser();
  await seedS1cUser();
  console.log('Reference data seeded successfully.');
}

const isMainModule =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));

if (isMainModule) {
  main()
    .then(async () => {
      await prisma.$disconnect();
    })
    .catch(async (error) => {
      console.error(error);
      await prisma.$disconnect();
      process.exit(1);
    });
}