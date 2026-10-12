import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

/**
 * Восстановление доступа при забытом пароле (Р-15, M02).
 *
 * Проверяется весь путь службы поддержки: администратор сбрасывает пароль из списка пользователей,
 * получает временный пароль, пользователь входит им и обязан сменить его при входе.
 * Заодно проверяются два свойства сброса: старый пароль перестаёт работать, а сам пароль
 * не попадает в журнал аудита.
 *
 * Пользователю выданы роли ОПР и НП — как в full-cycle.spec.ts: окно доступа Оператора (Р-07)
 * иначе сделало бы прогон зависимым от времени суток.
 */

const RUN_ID = Date.now().toString(36);
const LOGIN = 'e2e_reset_' + RUN_ID;
const TAB_NUMBER = 'RESET-' + RUN_ID;
const OLD_PASSWORD = 'OldPass1234';
const NEW_PASSWORD = 'NewPass12345';

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

async function login(page: import('@playwright/test').Page, login: string, password: string) {
  await page.getByLabel('Логин').fill(login);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
}

test.beforeAll(async () => {
  loadEnv();
  const { prisma } = await import('@prodtrack/db');
  const { RoleCode } = await import('@prodtrack/contracts');
  const bcrypt = await import('bcryptjs');

  const roles = await prisma.role.findMany();
  const roleByCode = Object.fromEntries(roles.map((role) => [role.code, role.id]));

  const employee = await prisma.employee.create({
    data: { fullName: 'Сброс Пароля ' + RUN_ID, tabNumber: TAB_NUMBER, active: true },
  });

  await prisma.user.create({
    data: {
      login: LOGIN,
      passwordHash: await bcrypt.hash(OLD_PASSWORD, 10),
      employeeId: employee.id,
      active: true,
      mustChangePassword: false,
      roles: { create: [{ roleId: roleByCode[RoleCode.OPR] }, { roleId: roleByCode[RoleCode.NP] }] },
    },
  });
});

test.afterAll(async () => {
  const { prisma } = await import('@prodtrack/db');
  const user = await prisma.user.findUnique({ where: { login: LOGIN } });
  if (user) {
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.userRole.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
  await prisma.employee.deleteMany({ where: { tabNumber: TAB_NUMBER } });
});

test('Сброс пароля: временный пароль, смена при входе, старый пароль не работает', async ({ page }) => {
  test.setTimeout(240000);
  const { prisma } = await import('@prodtrack/db');

  // 1. Администратор сбрасывает пароль прямо из списка пользователей.
  await page.goto('/login');
  await login(page, 'admin', 'admin123');
  await page.waitForURL(/\/dashboard/, { timeout: 60000 });

  await page.goto('/users?q=' + LOGIN);
  const row = page.locator('tbody tr', { hasText: LOGIN });
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: 'Сбросить пароль' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('открытые сессии завершатся');
  await dialog.getByRole('button', { name: 'Сбросить пароль' }).click();

  // Первый вызов серверного действия в dev-режиме компилируется на лету: ждём с запасом.
  await expect(dialog.locator('code')).toBeVisible({ timeout: 60000 });
  await expect(dialog).toContainText('показан один раз');
  const tempPassword = ((await dialog.locator('code').textContent()) ?? '').trim();
  expect(tempPassword.length).toBeGreaterThanOrEqual(8);
  await dialog.getByRole('button', { name: 'Готово' }).click();

  // В журнале — факт сброса и число закрытых сессий, но не сам пароль.
  const resetAudit = await prisma.auditRecord.findFirst({
    where: { objectType: 'User', field: 'passwordHash,sessions' },
    orderBy: { createdAt: 'desc' },
  });
  expect(resetAudit?.newValue ?? '').toContain('sessionsClosed');
  expect(resetAudit?.newValue ?? '').not.toContain(tempPassword);

  // 2. Старый пароль больше не подходит.
  await page.context().clearCookies();
  await page.goto('/login');
  await login(page, LOGIN, OLD_PASSWORD);
  await expect(page.getByText('Неверный логин или пароль')).toBeVisible({ timeout: 60000 });

  // 3. Временный пароль работает и требует смены при первом входе (Р-15).
  await login(page, LOGIN, tempPassword);
  await page.waitForURL(/\/change-password/, { timeout: 60000 });

  await page.getByLabel('Текущий пароль').fill(tempPassword);
  await page.getByLabel('Новый пароль').fill(NEW_PASSWORD);
  await page.getByLabel('Подтверждение пароля').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Сменить пароль' }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 60000 });

  // 4. Новый пароль сохранён, обязательная смена снята.
  await page.context().clearCookies();
  await page.goto('/login');
  await login(page, LOGIN, NEW_PASSWORD);
  await expect(page.getByRole('heading', { name: 'Сводный дашборд' })).toBeVisible({ timeout: 60000 });

  const saved = await prisma.user.findUniqueOrThrow({ where: { login: LOGIN } });
  expect(saved.mustChangePassword).toBe(false);
});

test('Свой пароль администратор так не сбрасывает', async ({ page }) => {
  test.setTimeout(120000);

  await page.goto('/login');
  await login(page, 'admin', 'admin123');
  await page.waitForURL(/\/dashboard/, { timeout: 60000 });

  await page.goto('/users?q=admin');
  const row = page.locator('tbody tr', { hasText: 'admin' }).first();
  await row.getByRole('button', { name: 'Сбросить пароль' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Сбросить пароль' }).click();

  // Себе сброс запрещён: он завершает сессии и выбросил бы администратора из системы.
  await expect(dialog).toContainText('Свой пароль так не сбрасывается');
});
