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
  orderId: string;
  op1EmployeeId: string;
  op2EmployeeId: string;
  massProductName: string;
  gpProductName: string;
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

  const npUser = await prisma.user.findUnique({ where: { login: 'test_multi_role' } });
  if (!npUser) throw new Error('test_multi_role not found');

  const order = await prisma.productionOrder.create({
    data: {
      shiftId: shift.id,
      status: 'DRAFT',
      createdById: npUser.id,
      lines: {
        create: [
          {
            workCenterId: wc01.id,
            productId: massProduct.id,
            plannedQuantity: 100,
            operatorId: emp1.id,
          },
          {
            workCenterId: wc03.id,
            productId: gpProduct.id,
            plannedQuantity: 50,
            operatorId: emp2.id,
          },
        ],
      },
    },
  });

  await prisma.productionOrder.update({
    where: { id: order.id },
    data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmedByUserId: npUser.id },
  });


  ctx = {
    npLogin: 'test_multi_role',
    npPassword: 'test1234',
    op1Login: op1.login,
    op1Password,
    op2Login: op2.login,
    op2Password,
    orderId: order.id,
    op1EmployeeId: emp1.id,
    op2EmployeeId: emp2.id,
    massProductName: massProduct.name,
    gpProductName: gpProduct.name,
  };

  await prisma.$disconnect();
});

async function login(page: import('@playwright/test').Page, login: string, password: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('Логин').fill(login);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL(/\/production-orders|\/shift-execution/, { timeout: 60000 });
}

test('E2E: production cycle with two operators', async ({ page }) => {
  test.setTimeout(180000);

  // 1. NP: verify confirmed order badge
  await login(page, ctx.npLogin, ctx.npPassword);
  await page.goto('/production-orders/' + ctx.orderId);
  await expect(page.locator('text=Подтверждено').first()).toBeVisible();

  // 2. Operator 1: accept and report MASS fact
  await login(page, ctx.op1Login, ctx.op1Password);
  await page.goto('/shift-execution');
  await page.getByRole('button', { name: 'Подтвердить получение' }).first().click();
  await page.locator('button:has-text("Подтвердить")').nth(1).evaluate((el) => (el as HTMLButtonElement).click());
  await page.getByRole('button', { name: 'Внести итог' }).first().click();
  await page.locator('div:has(> label:has-text("Выпуск")) > input').fill('100');
  await page.locator('div:has(> label:has-text("Брак")) > input').fill('2');
  await page.locator('div:has(> label:has-text("Причина брака")) select').selectOption({ index: 1 });
  await page.locator('div:has(> label:has-text("Остановки, шт.")) > input').fill('1');
  await page.locator('div:has(> label:has-text("Длительность, мин.")) > input').fill('30');
  await page.locator('button:has-text("Внести итог")').nth(1).evaluate((el) => (el as HTMLButtonElement).click());
  await page.waitForTimeout(2000);
  await expect(page.locator('text=Завершено').first()).toBeVisible();

  // 3. Operator 2: accept and report GP fact with consumption and defect
  await login(page, ctx.op2Login, ctx.op2Password);
  await page.goto('/shift-execution');
  await page.getByRole('button', { name: 'Подтвердить получение' }).first().click();
  await page.locator('button:has-text("Подтвердить")').nth(1).evaluate((el) => (el as HTMLButtonElement).click());
  await page.getByRole('button', { name: 'Внести итог' }).first().click();
  await page.locator('div:has(> label:has-text("Категория факта")) select').selectOption('GP');
  await page.locator('div:has(> label:has-text("Выпуск")) > input').fill('50');
  await page.locator('div:has(> label:has-text("Брак")) > input').fill('1');
  await page.locator('div:has(> label:has-text("Причина брака")) select').selectOption({ index: 1 });
  await page.locator('div:has(> label:has-text("Остановки, шт.")) > input').fill('2');
  await page.locator('div:has(> label:has-text("Длительность, мин.")) > input').fill('45');

  await page.getByRole('button', { name: 'Добавить строку потребления' }).evaluate((el) => (el as HTMLButtonElement).click());
  await page.locator('div:has-text("Потребление") select').last().selectOption({ index: 1 });
  await page.locator('div:has-text("Потребление") input[type=number]').last().fill('30');
  await page.locator('[role="dialog"] button:has-text("Внести итог")').evaluate((el) => (el as HTMLButtonElement).click());
  await page.waitForTimeout(2000);

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
  await expect(page.getByText(/\d{2}:\d{2}/).first()).toBeVisible();

  // 6. Stock balances
  await page.goto('/stock');
  await page.getByRole('button', { name: 'Производственный склад' }).click();
  await expect(page.locator('table')).toContainText(ctx.massProductName);
  await expect(page.locator('table')).toContainText(ctx.gpProductName);

  // 7. Order card badge and report button
  await page.goto('/production-orders/' + ctx.orderId);
  await expect(page.getByRole('button', { name: 'Отчёт за смену' })).toBeVisible();
  await page.getByRole('button', { name: 'Отчёт за смену' }).click();
  await page.waitForURL('/shift-reports/' + ctx.orderId);
  await expect(page.locator('h1')).toContainText('Отчёт за смену');
});