import { test, expect } from '@playwright/test';

test('home page renders ProdTrack', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('ProdTrack');
});

test('шапка: бренд не вылезает на пункты меню', async ({ page }) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/login');
  await page.getByLabel('Логин').fill('admin');
  await page.getByLabel('Пароль').fill('admin123');
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL(/dashboard/, { timeout: 60000 });

  // Дефект ОПЭ: с добавлением логотипа ссылка бренда сжималась флексом ниже своего содержимого,
  // и надпись «ProdTrack» вылезала на первый пункт меню («Дашборд»).
  const brand = page.locator('header a').first();
  const metrics = await brand.evaluate((element) => ({
    visible: element.clientWidth,
    needed: element.scrollWidth,
  }));
  expect(metrics.needed).toBeLessThanOrEqual(metrics.visible);

  const brandBox = await brand.boundingBox();
  const navBox = await page.getByRole('navigation').boundingBox();
  expect(brandBox).not.toBeNull();
  expect(navBox).not.toBeNull();

  // Сравниваем прямоугольники, а не только координату X: на узкой полосе меню переносится
  // на строку ниже, и это нормально — недопустимо именно пересечение.
  const overlaps = (
    first: { x: number; y: number; width: number; height: number },
    second: { x: number; y: number; width: number; height: number },
  ) =>
    Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x) > 0 &&
    Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y) > 0;

  expect(overlaps(brandBox!, navBox!)).toBe(false);

  // Редкие пункты уехали в выпадашку, поэтому меню снова помещается в одну строку.
  expect(navBox!.height).toBeLessThan(60);

  // ОПЭ-21: в одну строку должна умещаться вся шапка, а не только меню. Контейнер ограничен
  // max-w-7xl (1280 px); пока суммы не хватало на 38 px, блок «Уведомления · логин · Выйти»
  // переносился на вторую строку и вставал слева, а шапка вырастала со ~64 до 116 px.
  const headerRowBox = await page.locator('header > div').first().boundingBox();
  expect(headerRowBox).not.toBeNull();
  expect(headerRowBox!.height).toBeLessThan(80);

  await page.getByRole('button', { name: 'Администрирование' }).hover();
  await expect(page.getByRole('link', { name: 'Пользователи' }).first()).toBeVisible();
  await page.getByRole('link', { name: 'Аудит' }).first().click();
  await page.waitForURL(/\/audit/, { timeout: 60000 });
});

test('иконка сайта отдаётся без сессии', async ({ page }) => {
  // Иконка лежит в public/icon.svg и объявлена в метаданных; путь /icon.svg проверен на production-сборке.
  // Запрос делается без сессии: иконку запрашивает и браузер на экране входа,
  // поэтому ответ должен быть 200 с картинкой, а не редирект на /login.
  const icon = await page.request.get('/icon.svg');
  expect(icon.status()).toBe(200);
  expect(icon.headers()['content-type']).toContain('image/svg+xml');

  // И страница входа ссылается на эту иконку.
  const login = await page.request.get('/login');
  expect(await login.text()).toContain('/icon.svg');
});
