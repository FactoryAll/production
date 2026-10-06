import { test, expect } from '@playwright/test';
import { currentShiftNumber, localDateKey, resolveShiftId } from '@prodtrack/db';

/**
 * UC-M11-2: показатели дашборда обновляются в реальном времени, без перезагрузки страницы.
 *
 * Проверяется на живом контуре: тест открывает экран, затем создаёт документ напрямую в БД
 * и ждёт, пока он появится на экране. Никакого reload между этими шагами нет — обновление
 * приходит по SSE-каналу /api/events/dashboard.
 */
test('дашборд обновляется без перезагрузки (M11 BR-2)', async ({ page }) => {
  test.setTimeout(90000);

  const { prisma } = await import('@prodtrack/db');
  const marker = 'LIVE' + Date.now().toString(36).toUpperCase();

  // T-075: «текущая смена» — сегодняшняя дата и текущий номер по Р-05, поэтому смену берём
  // (или создаём) именно такую: со сменой из сида заказ в показатель не попал бы.
  const now = new Date();
  const shiftId = await resolveShiftId(prisma, {
    dateKey: localDateKey(now),
    number: currentShiftNumber(now),
  });

  const [workCenter, author] = await Promise.all([
    prisma.workCenter.findUniqueOrThrow({ where: { code: '01' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'test_multi_role' } }),
  ]);
  const product = await prisma.product.create({
    data: { code: marker, name: 'Живой продукт ' + marker, category: 'GP', unit: 'шт', active: true },
  });

  await page.goto('/login');
  await page.getByLabel('Логин').fill('test_multi_role');
  await page.getByLabel('Пароль').fill('test1234');
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL(/\/dashboard/);

  // Экран открыт. До мутации продукта на нём быть не может.
  await expect(page.getByText('Живой продукт ' + marker)).toHaveCount(0);

  await prisma.productionOrder.create({
    data: {
      shiftId,
      status: 'CONFIRMED',
      createdById: author.id,
      confirmedAt: new Date(),
      confirmedByUserId: author.id,
      lines: {
        create: [{ workCenterId: workCenter.id, productId: product.id, plannedQuantity: 7 }],
      },
    },
  });
  await prisma.$disconnect();

  // Экран должен обновиться сам — страница при этом не перезагружается.
  await expect(page.getByText('Живой продукт ' + marker)).toBeVisible({ timeout: 30000 });
});
