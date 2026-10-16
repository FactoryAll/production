import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

/**
 * Проверка нагрузки на вход: шесть пользователей входят одновременно.
 *
 * Повод — обращение из ОПЭ (16.10.2026): четыре пользователя заходили одновременно, двое получили
 * ERR_CONNECTION_RESET. Локально и в CI проверяем, что приложение выдерживает одновременные входы
 * и открытие дашборда: если такой тест начнёт падать, значит проблема в приложении, а не в сети.
 */

const RUN_ID = Date.now().toString(36);
const PASSWORD = 'Load12345';
const COUNT = 6;

function loadEnv() {
  if (process.env.DATABASE_URL) return;
  const envPath = path.resolve(__dirname, '../../../.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) {
      let v = m[2].trim();
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      process.env[m[1]] = v;
    }
  }
}

test.beforeAll(async () => {
  loadEnv();
  const { prisma } = await import('@prodtrack/db');
  const bcrypt = await import('bcryptjs');
  const role = await prisma.role.findUniqueOrThrow({ where: { code: 'NP' } });
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  for (let i = 0; i < COUNT; i += 1) {
    const login = 'load_' + RUN_ID + '_' + i;
    const employee = await prisma.employee.create({
      data: { fullName: 'Нагрузка ' + RUN_ID + ' ' + i, tabNumber: 'LOAD-' + RUN_ID + '-' + i, active: true },
    });
    await prisma.user.create({
      data: {
        login, passwordHash, employeeId: employee.id, active: true, mustChangePassword: false,
        roles: { create: [{ roleId: role.id }] },
      },
    });
  }
});

test.afterAll(async () => {
  const { prisma } = await import('@prodtrack/db');
  const users = await prisma.user.findMany({ where: { login: { startsWith: 'load_' + RUN_ID } } });
  for (const user of users) {
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.userRole.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
  await prisma.employee.deleteMany({ where: { tabNumber: { startsWith: 'LOAD-' + RUN_ID } } });
});

test('шесть одновременных входов и дашбордов', async ({ browser }) => {
  test.setTimeout(300000);

  const logins = Array.from({ length: COUNT }, (_, i) => 'load_' + RUN_ID + '_' + i);
  const results = await Promise.all(
    logins.map(async (login, index) => {
      const started = Date.now();
      const context = await browser.newContext();
      const page = await context.newPage();
      const problems: string[] = [];
      page.on('pageerror', (error) => problems.push('pageerror: ' + error.message));
      page.on('response', (response) => {
        if (response.status() >= 500) problems.push('HTTP ' + response.status() + ' ' + response.url());
      });
      page.on('requestfailed', (request) => {
        const reason = request.failure()?.errorText ?? '';
        // ERR_ABORTED — обычное прерывание загрузки при переходе и закрытии SSE, это не сбой.
        if (!reason.includes('ERR_ABORTED')) {
          problems.push('requestfailed: ' + reason + ' ' + request.url());
        }
      });

      try {
        await page.goto('/login');
        await page.getByLabel('Логин').fill(login);
        await page.getByLabel('Пароль').fill(PASSWORD);
        await page.getByRole('button', { name: 'Войти' }).click();
        await page.waitForURL(/dashboard/, { timeout: 90000 });
        await expect(page.getByRole('heading', { name: 'Сводный дашборд' })).toBeVisible({ timeout: 90000 });
      } catch (error) {
        problems.push('вход не завершился: ' + (error as Error).message.split('\n')[0]);
      }

      const elapsed = Date.now() - started;
      await context.close();
      return { index, elapsed, problems };
    }),
  );

  for (const result of results) {
    console.log(
      'пользователь ' + (result.index + 1) + ': ' + result.elapsed + ' мс' +
      (result.problems.length ? ' | проблемы: ' + result.problems.join('; ') : ' | без ошибок'),
    );
  }

  const failed = results.filter((result) => result.problems.length > 0);
  console.log('итог: успешно ' + (results.length - failed.length) + ' из ' + results.length);
  expect(failed).toEqual([]);
});