import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import {
  buildProductImportTemplate,
  isSupportedImportFile,
  loadWorkbook,
  readXlsxTable,
} from '../xlsx';
import { PRODUCT_IMPORT_COLUMNS, parseProductImportTable } from '../product-import';

async function buildUserFile(): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Лист1');
  sheet.addRow(['Список номенклатуры']);
  sheet.addRow(['Код', 'Наименование', 'Категория', 'Единица измерения']);
  sheet.addRow([100500, 'Позиция числовым кодом', 'ГП', 'шт']);
  sheet.addRow([]);
  sheet.addRow(['MASS001', 'Масса базовая', 'Масса', 'кг']);
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

describe('Чтение файла .xlsx', () => {
  it('принимает только .xlsx и .xlsm', () => {
    expect(isSupportedImportFile('Номенклатура.xlsx')).toBe(true);
    expect(isSupportedImportFile('Номенклатура.XLSM')).toBe(true);
    expect(isSupportedImportFile('Номенклатура.xls')).toBe(false);
    expect(isSupportedImportFile('Номенклатура.csv')).toBe(false);
  });

  it('читает лист как таблицу и передаёт её парсеру', async () => {
    const table = await readXlsxTable(await buildUserFile());
    const parsed = parseProductImportTable(table);

    expect(parsed.fatalError).toBeNull();
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toEqual([
      { rowNumber: 3, code: '100500', name: 'Позиция числовым кодом', category: 'GP', unit: 'шт' },
      { rowNumber: 5, code: 'MASS001', name: 'Масса базовая', category: 'MASS', unit: 'кг' },
    ]);
  });

  it('шаблон содержит те же колонки, что ждёт парсер', async () => {
    const template = await buildProductImportTemplate();
    const workbook = await loadWorkbook(template);

    const sheet = workbook.getWorksheet('Номенклатура');
    expect(sheet).toBeDefined();

    const headers = (sheet!.getRow(1).values as unknown[]).slice(1);
    expect(headers).toEqual(PRODUCT_IMPORT_COLUMNS.map((column) => column.header));

    // Данных в шаблоне нет: примеры в листе с колонками загрузили бы как номенклатуру.
    expect(sheet!.rowCount).toBe(1);

    const parsed = parseProductImportTable(await readXlsxTable(template));
    expect(parsed.fatalError).toBeNull();
    expect(parsed.rows).toEqual([]);
    expect(parsed.errors).toEqual([]);
  });

  it('шаблон содержит лист с инструкцией', async () => {
    const template = await buildProductImportTemplate();
    const workbook = await loadWorkbook(template);

    expect(workbook.getWorksheet('Инструкция')).toBeDefined();
  });
});
