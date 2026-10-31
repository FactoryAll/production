import { PrismaClient, RoleCode } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const WORK_CENTERS = [
  // Номер живёт в колонке «Код», в названии его не дублируем (замечание владельца 26.10.2026):
  // на проде названия были вычищены руками, и сид расходился с рабочей базой.
  { code: '01', name: 'Реактор' },
  { code: '02', name: 'Миксер' },
  { code: '03', name: 'Тубировка крем' },
  { code: '04', name: 'Тубировка паста' },
  { code: '05', name: 'Линия вязк.прод' },
  { code: '06', name: 'Линия жидк.прод' },
  { code: '07', name: 'П/авт вязк.прод' },
  { code: '08', name: 'П/авт жидк.прод' },
  { code: '09', name: 'Ручн налив №1' },
  { code: '10', name: 'Ручн налив №2' },
  { code: '11', name: 'Ручн налив №3' },
  { code: '12', name: 'Ручн налив №4' },
  // Маркировка ЧЗ (решение владельца 26.10.2026): нумерация сквозная, поэтому 13.
  // Особенность: в потребление этому РЦ идёт ТОЛЬКО полуфабрикат (ПФ) с Производственного склада.
  { code: '13', name: 'Маркировка ЧЗ' },
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

// Причины неявки работника в табеле (T-093, решение владельца 26.10.2026).
const ABSENCE_REASONS = [
  { code: 'ILLNESS', name: 'Болезнь' },
  { code: 'ABSENTEEISM', name: 'Прогул' },
  { code: 'VACATION', name: 'Отпуск' },
  { code: 'UNPAID_LEAVE', name: 'Отгул за свой счёт' },
  { code: 'UNEXCUSED', name: 'Неявка без объяснения' },
];

const DEFECT_REASONS = [
  { code: 'DEFECT_A', name: 'Брак A' },
  { code: 'DEFECT_B', name: 'Брак B' },
  { code: 'DEFECT_C', name: 'Брак C' },
];

export const ROLES = [
  { code: 'NP', name: 'Начальник производства' },
  { code: 'OPR', name: 'Оператор' },
  { code: 'KSGP', name: 'Кладовщик склада ГП' },
  { code: 'USGP', name: 'УСГП' },
  { code: 'S1C', name: 'Специалист 1С' },
  { code: 'ADM', name: 'Администратор' },
  // Гостевой доступ (решение владельца 25.10.2026): только просмотр ПЗ, Остатков, Перемещений.
  { code: 'GUEST', name: 'Гостевой доступ (только просмотр)' },
  // ОТК (решение владельца 26.10.2026): гостевой просмотр + отчёты.
  { code: 'OTK', name: 'ОТК (просмотр и отчёты)' },
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
  { code: 'transfer:read', action: 'Просмотр перемещений' },
  { code: 'stock:read', action: 'Просмотр остатков' },
  { code: 'shift_report:read', action: 'Просмотр отчётов смены' },
  { code: 'dashboard:read', action: 'Просмотр дашборда' },
  { code: 'dashboard:read_own', action: 'Просмотр своего дашборда' },
  { code: 'audit:read', action: 'Просмотр аудита' },
  { code: 'timing:read', action: 'Просмотр хронометража' },
  { code: 'onec:read', action: 'Просмотр данных для 1С' },
  { code: 'onec:process', action: 'Отметка обработано в 1С' },
  { code: 'nsi:manage', action: 'Управление НСИ' },
  { code: 'nsi:manage_warehouses', action: 'Управление складами' },
  { code: 'users:manage', action: 'Управление пользователями' },
  { code: 'roles:manage', action: 'Управление ролями' },
  // Отчёты (решение владельца 26.10.2026).
  { code: 'reports:read', action: 'Просмотр отчётов' },
  // Просмотр справочников. Кода не было в этом списке вовсе, хотя роли на него ссылались:
  // `.filter(Boolean)` в seedRoles молча выбрасывал его, и в базе права не появлялось (T-103).
  { code: 'nsi:read', action: 'Просмотр справочников' },
  // Доска производственного контура (T-103, решение владельца 29.10.2026).
  { code: 'kanban:read', action: 'Просмотр доски контура' },
];

export const ROLE_PERMISSION_MAP: Record<RoleCode, string[]> = {
  NP: [
    'reports:read',
    'kanban:read',
    'production_order:create',
    'production_order:update',
    'production_order:confirm',
    'production_order:read',
    'transfer:create',
    'transfer:update',
    'transfer:reconcile',
    'transfer:read',
    'stock:read',
    'shift_report:read',
    'dashboard:read',
    'audit:read',
    'timing:read',
    'nsi:read',
    'nsi:manage',
  ],
  OPR: [
    'timing:read',
    'production_order:read_own',
    // Без `production_order:confirm`: подтверждение/отмена ПЗ, ввод за Оператора
    // и корректировка факта — действия НП (00 §4.2, Р-11, Р-12).
    'production_order:accept',
    'production_order:report',
    'stock:read',
    'dashboard:read_own',
    'nsi:read',
  ],
  KSGP: [
    'timing:read',
    // Доска контура (T-103): у КСГП нет production_order:read, поэтому колонки ПЗ ему
    // не показываются — но перемещения своего склада он видит.
    'kanban:read',
    // Создание и корректировка Перемещения (решение владельца 21.10.2026, ОПЭ-25).
    'transfer:create',
    // Отправка черновика («Провести») требует transfer:update — без него созданный
    // черновик некуда деть (ОПЭ-26, проверено на проде 21.10.2026).
    'transfer:update',
    'transfer:read',
    'transfer:receive',
    'transfer:reconcile',
    'stock:read',
    'dashboard:read',
    'nsi:read',
  ],
  USGP: [
    'timing:read',
    // Доска контура (T-103): как и у КСГП — без колонок ПЗ, со своими перемещениями.
    'kanban:read',
    // Приёмка на Производственном складе (решение владельца 21.10.2026, ОПЭ-28).
    'transfer:receive',
    // Создание и корректировка Перемещения (решение владельца продукта, ОПЭ-20, 20.10.2026).
    'transfer:update',
    'transfer:create',
    'transfer:read',
    'transfer:reconcile',
    'stock:read',
    'dashboard:read',
    'nsi:read',
  ],
  S1C: [
    'reports:read',
    'kanban:read',
    'timing:read',
    // Просмотр ПЗ и Перемещений (решение владельца продукта, 03.10.2026).
    'transfer:read',
    'production_order:read',
    'onec:read',
    'onec:process',
    'stock:read',
    'dashboard:read',
    'nsi:read',
  ],
  ADM: PERMISSIONS.map(({ code }) => code),
  /**
   * Гостевой доступ (решение владельца 25.10.2026): только просмотр.
   * Ровно три экрана — ПЗ, Остатки, Перемещения. Ни одного права на изменение:
   * ни создания, ни подтверждения, ни приёмки, ни корректировки.
   * `dashboard:read` — потому что дашборд является точкой входа после входа в систему.
   */
  GUEST: [
    'production_order:read',
    'stock:read',
    'transfer:read',
    'dashboard:read',
    'kanban:read',
  ],
  /** ОТК (решение владельца 26.10.2026): гостевой просмотр + отчёты и доска, без прав на изменение. */
  OTK: [
    'production_order:read',
    'stock:read',
    'transfer:read',
    'dashboard:read',
    'reports:read',
    'kanban:read',
  ],
};

/**
 * Справочные данные сид только создаёт — существующие записи он не перезаписывает.
 *
 * Раньше здесь был upsert с полями в `update`, и каждое развёртывание возвращало названия РЦ,
 * складов и причин к исходным: правки администратора (например, убранный префикс «01.» в названии
 * РЦ) держались до первого деплоя. Признак активности сид тоже больше не поднимает — то же
 * правило, что и для смен (T-075): заведённые данные принадлежат администратору, а не сиду.
 */
export async function seedWorkCenters(client: PrismaClient = prisma): Promise<void> {
  for (const { code, name } of WORK_CENTERS) {
    const existing = await client.workCenter.findUnique({ where: { code } });
    if (existing) {
      continue;
    }
    await client.workCenter.create({
      data: { code, name, producesMass: producesMassByCode(code), active: true },
    });
  }
}

export async function seedWarehouses(client: PrismaClient = prisma): Promise<void> {
  for (const { name, type, description } of WAREHOUSES) {
    // Ищем по типу, а не по названию: название администратор вправе изменить (Р-19),
    // и поиск по нему заводил бы второй склад с тем же типом.
    const existing = await client.warehouse.findFirst({ where: { type } });
    if (existing) {
      continue;
    }
    await client.warehouse.create({
      data: { name, type, description, active: true },
    });
  }
}

export async function seedSubstitutionReasons(client: PrismaClient = prisma): Promise<void> {
  for (const { code, name } of SUBSTITUTION_REASONS) {
    const existing = await client.substitutionReason.findUnique({ where: { code } });
    if (existing) {
      continue;
    }
    await client.substitutionReason.create({ data: { code, name, active: true } });
  }
}

export async function seedAbsenceReasons(client: PrismaClient = prisma): Promise<void> {
  for (const { code, name } of ABSENCE_REASONS) {
    const existing = await client.absenceReason.findUnique({ where: { code } });
    if (existing) {
      continue;
    }
    await client.absenceReason.create({ data: { code, name, active: true } });
  }
}

export async function seedDefectReasons(client: PrismaClient = prisma): Promise<void> {
  for (const { code, name } of DEFECT_REASONS) {
    const existing = await client.defectReason.findUnique({ where: { code } });
    if (existing) {
      continue;
    }
    await client.defectReason.create({ data: { code, name, active: true } });
  }
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

async function seedMultiRoleUser(client: PrismaClient = prisma): Promise<void> {
  const roles = await client.role.findMany({
    where: { code: { in: TEST_MULTI_ROLE_ROLES } },
  });

  if (roles.length === 0) return;

  // Существующую учётную запись сид не трогает: сброшенный или изменённый пароль,
  // блокировка и состав ролей — это данные, а не исходное наполнение.
  const existing = await client.user.findUnique({ where: { login: TEST_MULTI_ROLE_LOGIN } });
  if (existing) return;

  await client.user.create({
    data: {
      login: TEST_MULTI_ROLE_LOGIN,
      passwordHash: await bcrypt.hash(TEST_MULTI_ROLE_PASSWORD, 10),
      active: true,
      mustChangePassword: false,
      roles: { create: roles.map((role) => ({ roleId: role.id })) },
    },
  });
}

async function seedFirstLoginUser(client: PrismaClient = prisma): Promise<void> {
  const role = await client.role.findUnique({ where: { code: 'OPR' } });
  if (!role) return;

  const existing = await client.user.findUnique({ where: { login: TEST_FIRST_LOGIN_LOGIN } });
  if (existing) return;

  await client.user.create({
    data: {
      login: TEST_FIRST_LOGIN_LOGIN,
      passwordHash: await bcrypt.hash(TEST_FIRST_LOGIN_PASSWORD, 10),
      active: true,
      mustChangePassword: true,
      roles: { create: [{ roleId: role.id }] },
    },
  });
}

async function seedOprShiftUser(client: PrismaClient = prisma): Promise<void> {
  const role = await client.role.findUnique({ where: { code: 'OPR' } });
  if (!role) return;

  const existing = await client.user.findUnique({ where: { login: TEST_OPR_SHIFT_LOGIN } });
  if (existing) return;

  await client.user.create({
    data: {
      login: TEST_OPR_SHIFT_LOGIN,
      passwordHash: await bcrypt.hash(TEST_OPR_SHIFT_PASSWORD, 10),
      active: true,
      mustChangePassword: false,
      roles: { create: [{ roleId: role.id }] },
    },
  });
}

async function seedS1cUser(client: PrismaClient = prisma): Promise<void> {
  const role = await client.role.findUnique({ where: { code: 'S1C' } });
  if (!role) return;

  const existing = await client.user.findUnique({ where: { login: TEST_S1C_LOGIN } });
  if (existing) return;

  await client.user.create({
    data: {
      login: TEST_S1C_LOGIN,
      passwordHash: await bcrypt.hash(TEST_S1C_PASSWORD, 10),
      active: true,
      mustChangePassword: false,
      roles: { create: [{ roleId: role.id }] },
    },
  });
}

export async function seedAdmin(client: PrismaClient = prisma): Promise<void> {
  const adminRole = await client.role.findUnique({ where: { code: 'ADM' } });
  if (!adminRole) return;

  // Пароль администратора сид не сбрасывает: иначе после каждого развёртывания снова работал бы
  // исходный пароль из сида, а смена пароля на стенде терялась бы.
  const existing = await client.user.findUnique({ where: { login: ADMIN_LOGIN } });
  if (existing) return;

  await client.user.create({
    data: {
      login: ADMIN_LOGIN,
      passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 10),
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
  await seedAbsenceReasons();
  // Смены сид больше не создаёт (T-075): это данные, а не справочник — запись смены заводит
  // система, когда НП выбирает дату и номер в форме ПЗ. Шаблонные смены с датой 2000-01-01
  // остались только в исторических базах и больше не поднимаются при каждом деплое.
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