import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';
import ExcelJS from 'exceljs';

/**
 * Загрузка номенклатуры из файла .xlsx (этап 5, задание владельца 12.10.2026).
 *
 * Проверяется настоящий путь загрузки: браузер выбирает файл, server action принимает его
 * multipart-запросом, exceljs разбирает книгу, справочник и журнал аудита обновляются.
 * Ни один unit-тест этот путь не покрывает: там файл подставляется в обход сети.
 *
 * Файлы собираются exceljs — то есть тем же инструментом, что и шаблон, — а данные пишутся
 * под уникальными кодами RUN_ID, чтобы прогон не зависел от предыдущих.
 */

const RUN_ID = Date.now().toString(36);
const PREFIX = 'A' + RUN_ID.toUpperCase().slice(-5) + '-';
const HEADERS = ['Код', 'Наименование', 'Категория', 'Единица измерения'];

const goodFile = path.join(os.tmpdir(), 'nomenclature-' + RUN_ID + '.xlsx');
const badFile = path.join(os.tmpdir(), 'nomenclature-bad-' + RUN_ID + '.xlsx');

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

async function writeWorkbook(target: string, rows: (string | number)[][]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Номенклатура');
  sheet.addRow(['Выгрузка номенклатуры']);
  sheet.addRow(HEADERS);
  rows.forEach((row) => sheet.addRow(row));
  await workbook.xlsx.writeFile(target);
}

const createdCodes = [PREFIX + '001', PREFIX + '002', PREFIX + '003'];

test.beforeAll(async () => {
  loadEnv();
  await writeWorkbook(goodFile, [
    [createdCodes[0], 'Позиция первая ' + RUN_ID, 'ГП', 'шт'],
    [createdCodes[1], 'Позиция вторая ' + RUN_ID, 'Масса', 'кг'],
    [createdCodes[2], 'Позиция третья ' + RUN_ID, 'ГП', 'уп'],
  ]);
  await writeWorkbook(badFile, [
    [PREFIX + '900', 'Позиция с ошибкой ' + RUN_ID, 'ПФ', 'шт'],
  ]);
});

test.afterAll(async () => {
  const { prisma } = await import('@prodtrack/db');
  await prisma.product.deleteMany({ where: { code: { startsWith: PREFIX } } });
  for (const file of [goodFile, badFile]) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});

async function loginAsAdmin(page: import('@playwright/test').Page) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('Логин').fill('admin');
  await page.getByLabel('Пароль').fill('admin123');
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 60000 });
}

test('Загрузка номенклатуры из файла: проверка, загрузка и запись в справочник', async ({ page }) => {
  test.setTimeout(180000);
  const { prisma } = await import('@prodtrack/db');

  await loginAsAdmin(page);
  await page.goto('/nsi/products');
  await expect(page.getByRole('heading', { name: 'Номенклатура' })).toBeVisible();

  await page.getByRole('button', { name: 'Загрузить из файла' }).click();
  await page.setInputFiles('#import-file', goodFile);
  await page.getByRole('button', { name: 'Проверить файл' }).click();

  // Отчёт проверки: три строки, все — на создание, ошибок нет.
  await expect(page.getByText(/Строк с данными: 3/)).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/новых: 3/)).toBeVisible();
  await expect(page.getByText(createdCodes[0])).toBeVisible();

  await page.getByRole('button', { name: 'Загрузить (3)' }).click();
  await expect(page.getByText(/Загрузка выполнена/)).toBeVisible({ timeout: 60000 });
  await expect(page.getByText(/создано: 3/)).toBeVisible();

  await page.getByRole('button', { name: 'Закрыть' }).click();

  // Данные действительно записаны, с категориями из файла.
  const saved = await prisma.product.findMany({
    where: { code: { in: createdCodes } },
    orderBy: { code: 'asc' },
  });
  expect(saved).toHaveLength(3);
  expect(saved[0]).toMatchObject({ name: 'Позиция первая ' + RUN_ID, category: 'GP', unit: 'шт', active: true });
  expect(saved[1]).toMatchObject({ category: 'MASS', unit: 'кг' });

  // Загрузка попала в журнал аудита: по записи на позицию плюс сводная запись о файле.
  const audits = await prisma.auditRecord.findMany({
    where: { objectId: { in: saved.map((product) => product.id) } },
  });
  expect(audits).toHaveLength(3);
  expect(audits.every((record) => record.action === 'CREATE' && record.objectType === 'Product')).toBe(true);

  const summary = await prisma.auditRecord.findFirst({
    where: { objectType: 'ProductImport' },
    orderBy: { createdAt: 'desc' },
  });
  expect(summary?.newValue).toContain('created');

  // В справочнике появились новые позиции — без перезагрузки страницы.
  await expect(page.getByText(createdCodes[0])).toBeVisible();
});

test('Строка с недопустимой категорией блокирует загрузку', async ({ page }) => {
  test.setTimeout(120000);
  const { prisma } = await import('@prodtrack/db');

  await loginAsAdmin(page);
  await page.goto('/nsi/products');

  await page.getByRole('button', { name: 'Загрузить из файла' }).click();
  await page.setInputFiles('#import-file', badFile);
  await page.getByRole('button', { name: 'Проверить файл' }).click();

  await expect(page.getByText(/ПФ — не отдельная категория/)).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Загрузить (0)' })).toBeDisabled();

  const created = await prisma.product.count({ where: { code: PREFIX + '900' } });
  expect(created).toBe(0);
});

test('Шаблон файла скачивается администратором', async ({ page }) => {
  test.setTimeout(120000);

  await loginAsAdmin(page);
  const response = await page.request.get('/nsi/products/template');

  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('spreadsheetml');
  expect((await response.body()).byteLength).toBeGreaterThan(1000);
});
