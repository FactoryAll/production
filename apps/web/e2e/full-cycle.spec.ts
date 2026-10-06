import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

/**
 * T-056: сквозной смоук контура.
 *
 * Один сценарий проходит весь жизненный цикл (00 §2) без ручных шагов:
 * вход → НСИ → ПЗ → факт → остатки → отчёт → Перемещение → приёмка → уведомления →
 * аудит → 1С → дашборд.
 *
 * ПЗ создаётся через форму (а не вставкой в БД): именно сквозной путь формы не виден
 * ни типам, ни сервисным тестам (урок Фазы 5, п. 3).
 *
 * Оператору выданы две роли — ОПР и НП. Так сделано и в production-cycle.spec.ts:
 * окно доступа ОПР (Р-07, 07:00–21:00 / 19:00–09:00) иначе делало бы прогон CI зависимым
 * от времени суток. Само окно покрыто unit-тестами (require-shift-window.test.ts).
 */

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
  operatorLogin: string;
  operatorPassword: string;
  ksLogin: string;
  ksPassword: string;
  s1cLogin: string;
  s1cPassword: string;
  productName: string;
  productLabel: string;
  productCode: string;
  workCenterLabel: string;
  operatorFullName: string;
};

async function login(page: import('@playwright/test').Page, login: string, password: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('Логин').fill(login);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 60000 });
}

test.beforeAll(async () => {
  loadEnv();
  const { prisma } = await import('@prodtrack/db');
  const { RoleCode } = await import('@prodtrack/contracts');
  const bcrypt = await import('bcryptjs');

  const roles = await prisma.role.findMany();
  const roleByCode = Object.fromEntries(roles.map((role) => [role.code, role.id]));

  const workCenter = await prisma.workCenter.findUniqueOrThrow({ where: { code: '03' } });
  const password = 'Smoke1234!';
  const passwordHash = await bcrypt.hash(password, 10);

  const product = await prisma.product.create({
    data: {
      code: 'SMOKE-' + RUN_ID,
      name: 'Смоук ГП ' + RUN_ID,
      category: 'GP',
      unit: 'шт',
      active: true,
    },
  });

  const operatorEmployee = await prisma.employee.create({
    data: { fullName: 'Смоук Оператор ' + RUN_ID, tabNumber: 'SMOKE-' + RUN_ID, active: true },
  });
  await prisma.user.create({
    data: {
      login: 'smoke_opr_' + RUN_ID,
      passwordHash,
      employeeId: operatorEmployee.id,
      active: true,
      mustChangePassword: false,
      roles: {
        create: [{ roleId: roleByCode[RoleCode.OPR] }, { roleId: roleByCode[RoleCode.NP] }],
      },
    },
  });

  await prisma.user.create({
    data: {
      login: 'smoke_ksgp_' + RUN_ID,
      passwordHash,
      active: true,
      mustChangePassword: false,
      roles: { create: [{ roleId: roleByCode[RoleCode.KSGP] }] },
    },
  });

  // Клиент Prisma намеренно не закрываем: @prodtrack/db экспортирует общий экземпляр,
  // и его закрытие посреди сценария рвёт соединения приложения (дефект окружения, T-056).
  ctx = {
    npLogin: 'test_multi_role',
    npPassword: 'test1234',
    operatorLogin: 'smoke_opr_' + RUN_ID,
    operatorPassword: password,
    ksLogin: 'smoke_ksgp_' + RUN_ID,
    ksPassword: password,
    s1cLogin: 'test_s1c',
    s1cPassword: 's1c12345',
    productName: product.name,
    productLabel: product.code + ' – ' + product.name + ' (' + product.unit + ')',
    productCode: product.code,
    workCenterLabel: workCenter.code + ' – ' + workCenter.name + ' (ГП)',
    operatorFullName: operatorEmployee.fullName,
  };
});

async function findCreatedOrderId(): Promise<string> {
  const { prisma } = await import('@prodtrack/db');
  const product = await prisma.product.findUniqueOrThrow({ where: { code: ctx.productCode } });
  const line = await prisma.productionOrderLine.findFirstOrThrow({
    where: { productId: product.id },
    orderBy: { createdAt: 'desc' },
  });
  return line.orderId;
}

test('Сквозной смоук контура: ПЗ → факт → перемещение → приёмка → 1С → дашборд', async ({ page }) => {
  test.setTimeout(240000);

  // 1. Вход. Домашняя страница приложения — сводный дашборд (M11).
  await login(page, ctx.npLogin, ctx.npPassword);
  await expect(page.getByRole('heading', { name: 'Сводный дашборд' })).toBeVisible();

  // 2. НСИ
  await page.goto('/nsi/work-centers');
  await expect(page.getByText('01.Реактор')).toBeVisible();

  // 3. ПЗ создаётся через форму
  await page.goto('/production-orders/new');
  // T-075: дата смены и её номер подставлены по умолчанию (сегодня и текущая смена по Р-05).
  await page.getByLabel('Рабочий центр').selectOption({ label: ctx.workCenterLabel });
  await page.getByLabel('Номенклатура').selectOption({ label: ctx.productLabel });
  await page.getByLabel('Плановое количество').fill('50');
  // exact: иначе в выборку попадает чекбокс работника с ФИО «… Оператор …».
  await page.getByLabel('Оператор', { exact: true }).selectOption({ label: ctx.operatorFullName });
  await page.getByRole('button', { name: 'Сохранить черновик' }).click();
  await page.waitForURL(/\/production-orders$/);

  const orderId = await findCreatedOrderId();

  // 4. Подтверждение ПЗ (EV-01)
  await page.goto('/production-orders/' + orderId);
  await page.getByRole('button', { name: 'Подтвердить ПЗ' }).click();
  await page.locator('[role="dialog"]').getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.locator('text=Подтверждено').first()).toBeVisible();

  // 5. Факт: Оператор подтверждает получение и вносит итог смены
  await login(page, ctx.operatorLogin, ctx.operatorPassword);
  await page.goto('/shift-execution');
  await page.getByRole('button', { name: 'Подтвердить получение' }).first().click();
  await page.locator('button:has-text("Подтвердить")').nth(1).evaluate((el) => (el as HTMLButtonElement).click());
  await page.getByRole('button', { name: 'Внести итог' }).first().click();
  await page.locator('div:has(> label:has-text("Выпуск ГП")) > input').fill('50');
  await page.locator('div:has(> label:has-text("Выпуск ПФ")) > input').fill('0');
  await page.locator('div:has(> label:has-text("Брак")) > input').fill('0');
  await page.locator('div:has(> label:has-text("Остановки, шт.")) > input').fill('0');
  await page.locator('div:has(> label:has-text("Длительность, мин.")) > input').fill('0');
  await page.locator('button:has-text("Внести итог")').nth(1).evaluate((el) => (el as HTMLButtonElement).click());
  await page.waitForTimeout(2000);
  // ПЗ с единственным РЦ закрывается сразу после внесения итога (Р-04).
  await page.goto('/production-orders/' + orderId);
  await expect(page.locator('text=Завершено').first()).toBeVisible();

  // 6. Остатки: выпуск ГП пришёл на Производственный склад
  await page.goto('/stock');
  await page.getByRole('button', { name: 'Производственный склад' }).click();
  await expect(page.locator('table')).toContainText(ctx.productName);

  // 7. Отчёт за смену
  await page.goto('/shift-reports/' + orderId);
  await expect(page.getByText('План/факт по РЦ')).toBeVisible();
  await expect(page.getByText('Структура выпуска')).toBeVisible();

  // 8. Перемещение ГП на склад ГП: создаёт и отправляет НП
  await login(page, ctx.npLogin, ctx.npPassword);
  await page.goto('/transfers/new');
  await page.getByLabel('Склад-источник').selectOption({ label: 'Производственный' });
  await page.getByLabel('Склад-приёмник').selectOption({ label: 'Склад ГП' });
  await page.getByLabel('Продукт').selectOption({ label: ctx.productLabel });
  await page.getByLabel('Плановое количество').fill('20');
  await page.getByRole('button', { name: 'Сохранить черновик' }).click();
  await page.waitForURL(/\/transfers$/);

  const transferId = await findCreatedTransferId();
  await page.goto('/transfers/' + transferId);
  await page.getByRole('button', { name: 'Отправить' }).click();
  await page.locator('[role="dialog"]').getByRole('button', { name: 'Отправить' }).click();
  await expect(page.locator('text=Отправлено').first()).toBeVisible();

  // 9. Приёмка на складе ГП (EV-05)
  await login(page, ctx.ksLogin, ctx.ksPassword);
  await page.goto('/transfers/' + transferId + '/receive');
  await page.locator('table input[type="number"]').first().fill('20');
  await page.getByRole('button', { name: 'Принять' }).click();
  await expect(page.locator('text=Принято').first()).toBeVisible({ timeout: 30000 });

  // 10. Уведомления приходят участникам контура (EV-04 → КСГП)
  await page.goto('/notifications');
  await expect(page.getByText('Перемещение отправлено').first()).toBeVisible();

  // 11. Аудит пройденных действий
  await login(page, ctx.npLogin, ctx.npPassword);
  await page.goto('/audit');
  await expect(page.locator('tbody tr').first()).toBeVisible();

  // 12. Рабочее место 1С: задача по принятому Перемещению
  await login(page, ctx.s1cLogin, ctx.s1cPassword);
  await page.goto('/onec');
  await expect(page.locator('table')).toContainText('Перемещение');

  // 13. Дашборд: контур виден целиком
  await login(page, ctx.npLogin, ctx.npPassword);
  await expect(page.getByRole('heading', { name: 'Сводный дашборд' })).toBeVisible();
  await expect(page.getByText('Принято на склад ГП за период')).toBeVisible();
  await expect(page.getByText('Документы жизненного цикла')).toBeVisible();
});

async function findCreatedTransferId(): Promise<string> {
  const { prisma } = await import('@prodtrack/db');
  const line = await prisma.transferLine.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
  return line.goodsTransferId;
}
