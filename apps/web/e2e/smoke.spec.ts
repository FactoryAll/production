import { test, expect } from '@playwright/test';

test('home page renders ProdTrack', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('ProdTrack');
});

test('иконка сайта отдаётся без сессии', async ({ page }) => {
  // Next.js отдаёт файл app/icon.svg по пути /icon.svg (проверено на production-сборке).
  // Запрос делается без сессии: иконку запрашивает и браузер на экране входа,
  // поэтому ответ должен быть 200 с картинкой, а не редирект на /login.
  const icon = await page.request.get('/icon.svg');
  expect(icon.status()).toBe(200);
  expect(icon.headers()['content-type']).toContain('image/svg+xml');

  // И страница входа ссылается на эту иконку.
  const login = await page.request.get('/login');
  expect(await login.text()).toContain('/icon.svg');
});
