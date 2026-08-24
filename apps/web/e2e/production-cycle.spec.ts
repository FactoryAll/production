import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const RUN_ID = Date.now().toString(36);

function loadEnv() {
  if (process.env.DATABASE_URL) return;
  const envPath = path.resolve(__dirname, '../../../.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf-8');
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) {
      let v = m[2].trim();
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      process.env[m[1]] = v;
    }
  }
}

let ctx: {
  npLogin: string;
  npPassword: string;
  op1Login: string;
  op1Password: string;
  op2Login: string;
  op2Password: string;
  workCenter01Id: string;
  workCenter03Id: string;
  massProductId: string;
  gpProductId: string;
  op1EmployeeId: string;
  op2EmployeeId: string;
  shiftId: string;
  orderId: string;
};

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  loadEnv();
  const { prisma } = await import('@prodtrack/db');
  const { RoleCode } = await import('@prodtrack/contracts');
  const bcrypt = await import('bcryptjs');

  const roles = await prisma.role.findMany({ where: { code: { in: [RoleCode.OPR, RoleCode.NP] } } });
  const roleByCode = Object.fromEntries(roles.map((r) => [r.code, r.id]));

  const shift = await prisma.shift.findFirst({ where: { active: true }, orderBy: { number: 'asc' } });
  if (!shift) throw new Error('No active shift found');

  const wc01 = await prisma.workCenter.findUnique({ where: { code: '01' } });
  const wc03 = await prisma.workCenter.findUnique({ where: { code: '03' } });
  if (!wc01 || !wc03) throw new Error('Work centers 01/03 not found');

  const emp1 = await prisma.employee.create({
    data: { fullName: 'E2E Operator 1', tabNumber: 'E2E-OP1-' + RUN_ID, active: true },
  });
  const emp2 = await prisma.employee.create({
    data: { fullName: 'E2E Operator 2', tabNumber: 'E2E-OP2-' + RUN_ID, active: true },
  });

  const hash = async (plain: string) => bcrypt.hash(plain, 10);

  const op1Password = 'Pass1234!';
  const op2Password = 'Pass1234!';
  const op1 = await prisma.user.create({
    data: {
      login: 'e2e_op1_' + RUN_ID,
      passwordHash: await hash(op1Password),
      employeeId: emp1.id,
      active: true,
      mustChangePassword: false,
      roles: { create: [{ roleId: roleByCode[RoleCode.OPR] }, { roleId: roleByCode[RoleCode.NP] }] },
    },
  });
  const op2 = await prisma.user.create({
    data: {
      login: 'e2e_op2_' + RUN_ID,
      passwordHash: await hash(op2Password),
      employeeId: emp2.id,
      active: true,
      mustChangePassword: false,
      roles: { create: [{ roleId: roleByCode[RoleCode.OPR] }, { roleId: roleByCode[RoleCode.NP] }] },
    },
  });

  const massProduct = await prisma.product.create({
    data: { code: 'MASS-E2E-' + RUN_ID, name: 'Масса E2E ' + RUN_ID, category: 'MASS', unit: 'кг', active: true },
  });
  const gpProduct = await prisma.product.create({
    data: { code: 'GP-E2E-' + RUN_ID, name: 'ГП E2E ' + RUN_ID, category: 'GP', unit: 'шт', active: true },
  });

  ctx = {
    npLogin: 'test_multi_role',
    npPassword: 'test1234',
    op1Login: op1.login,
    op1Password,
    op2Login: op2.login,
    op2Password,
    workCenter01Id: wc01.id,
    workCenter03Id: wc03.id,
    massProductId: massProduct.id,
    gpProductId: gpProduct.id,
    op1EmployeeId: emp1.id,
    op2EmployeeId: emp2.id,
    shiftId: shift.id,
    orderId: '',
  };

  await prisma.$disconnect();
});

async function login(page: import('@playwright/test').Page, login: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Логин').fill(login);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL(/\/dashboard/);
}

test('E2E: production cycle with two operators', async ({ page }) => {
  test.setTimeout(180000);

  // 1. NP creates production order with two lines (fixtures created in DB setup)
  await login(page, ctx.npLogin, ctx.npPassword);
  await page.goto('/production-orders/new');
  await page.getByLabel('Смена').selectOption(ctx.shiftId);

  await page.getByLabel('Рабочий центр').first().selectOption(ctx.workCenter01Id);
  await page.getByLabel('Номенклатура').first().selectOption(ctx.massProductId);
  await page.getByLabel('Плановое количество').first().fill('100');
  await page.getByLabel('Оператор').first().selectOption(ctx.op1EmployeeId);

  await page.getByRole('button', { name: '+ Добавить РЦ' }).click();
  await page.getByLabel('Рабочий центр').nth(1).selectOption(ctx.workCenter03Id);
  await page.getByLabel('Номенклатура').nth(1).selectOption(ctx.gpProductId);
  await page.getByLabel('Плановое количество').nth(1).fill('50');
  await page.getByLabel('Оператор').nth(1).selectOption(ctx.op2EmployeeId);

  await page.getByRole('button', { name: 'Сохранить черновик' }).click();
  await page.waitForURL('/production-orders');

  // Read the created order id from DB
  const { prisma } = await import('@prodtrack/db');
  const npUser = await prisma.user.findUnique({ where: { login: ctx.npLogin } });
  const order = await prisma.productionOrder.findFirst({
    where: { createdById: npUser!.id },
    orderBy: { createdAt: 'desc' },
  });
  expect(order).toBeTruthy();
  ctx.orderId = order!.id;
  await prisma.$disconnect();

  // Confirm the order (EV-01)
  await page.goto('/production-orders/' + ctx.orderId);
  await page.getByRole('button', { name: 'Подтвердить ПЗ' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.locator('text=Подтверждено')).toBeVisible();

  // 2. Operator 1: accept and report MASS fact
  await login(page, ctx.op1Login, ctx.op1Password);
  await page.goto('/shift-execution');
  await page.getByRole('button', { name: 'Подтвердить получение' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить' }).click();
  await page.getByRole('button', { name: 'Внести итог' }).click();
  await page.getByLabel('Выпуск').fill('100');
  await page.getByLabel('Брак').fill('2');
  await page.getByLabel('Причина брака').selectOption({ label: 'Брак A' });
  await page.getByLabel('Остановки, шт.').fill('1');
  await page.getByLabel('Длительность, мин.').fill('30');
  await page.getByRole('dialog').getByRole('button', { name: 'Внести итог' }).click();
  await expect(page.locator('text=Завершено')).toBeVisible();

  // 3. Operator 2: accept and report GP fact with consumption and defect
  await login(page, ctx.op2Login, ctx.op2Password);
  await page.goto('/shift-execution');
  await page.getByRole('button', { name: 'Подтвердить получение' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить' }).click();
  await page.getByRole('button', { name: 'Внести итог' }).click();
  await page.getByLabel('Категория факта').selectOption('GP');
  await page.getByLabel('Выпуск').fill('50');
  await page.getByLabel('Брак').fill('1');
  await page.getByLabel('Причина брака').selectOption({ label: 'Брак B' });
  await page.getByLabel('Остановки, шт.').fill('2');
  await page.getByLabel('Длительность, мин.').fill('45');

  await page.getByRole('button', { name: 'Добавить строку потребления' }).click();
  await page.locator('select').last().selectOption(ctx.massProductId);
  await page.getByPlaceholder('Количество').last().fill('30');

  await page.getByRole('dialog').getByRole('button', { name: 'Внести итог' }).click();
  await expect(page.locator('text=Завершено')).toBeVisible();

  // 4. Verify order is COMPLETED
  await login(page, ctx.npLogin, ctx.npPassword);
  await page.goto('/production-orders/' + ctx.orderId);
  await expect(page.locator('text=Завершено').first()).toBeVisible();

  // 5. Shift report: 4 charts + consumption table + hh:mm durations
  await page.goto('/shift-reports/' + ctx.orderId);
  await expect(page.locator('text=План/факт по РЦ')).toBeVisible();
  await expect(page.locator('text=Структура выпуска')).toBeVisible();
  await expect(page.locator('text=Брак по причинам')).toBeVisible();
  await expect(page.locator('text=Остановки по длительности')).toBeVisible();
  await expect(page.locator('text=Потребление материалов')).toBeVisible();
  await expect(page.locator('text=\d{2}:\d{2}').first()).toBeVisible();

  // 6. Stock balances
  await page.goto('/stock');
  await page.getByRole('button', { name: 'Производственный склад' }).click();
  await page.locator('select').filter({ hasText: 'Все категории' }).selectOption('MASS');
  await expect(page.locator('table')).toContainText('70.00');
  await page.locator('select').filter({ hasText: 'MASS' }).selectOption('GP');
  await expect(page.locator('table')).toContainText('50.00');

  // 7. Order card badge and report button
  await page.goto('/production-orders/' + ctx.orderId);
  await expect(page.getByRole('button', { name: 'Отчёт за смену' })).toBeVisible();
  await page.getByRole('button', { name: 'Отчёт за смену' }).click();
  await page.waitForURL('/shift-reports/' + ctx.orderId);
  await expect(page.locator('h1')).toContainText('Отчёт за смену');
});
