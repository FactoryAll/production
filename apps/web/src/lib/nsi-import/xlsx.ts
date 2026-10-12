// Чтение файла .xlsx и сборка шаблона (этап 5).
//
// Единственное место, где используется exceljs: остальная логика импорта — чистые модули.

import ExcelJS from 'exceljs';
import {
  MAX_IMPORT_ROWS,
  PRODUCT_IMPORT_COLUMNS,
  MAX_UNIT_LENGTH,
} from './product-import';

/** Что принимает инструмент: .xlsx (и макросный .xlsm — та же структура). */
export const IMPORT_FILE_EXTENSIONS = ['.xlsx', '.xlsm'];

export function isSupportedImportFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return IMPORT_FILE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/** Байты в виде, который принимают Blob и Response: массив над обычным `ArrayBuffer`. */
function toBytes(source: ArrayBufferView | ArrayBuffer): Uint8Array<ArrayBuffer> {
  const view =
    source instanceof ArrayBuffer
      ? new Uint8Array(source)
      : new Uint8Array(source.buffer as ArrayBuffer, source.byteOffset, source.byteLength);
  return new Uint8Array(view);
}

function cellToText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    // Коды часто хранят числом; десятичная часть у них не нужна, а экспонента мешает читать код.
    return Number.isInteger(value) ? value.toFixed(0) : String(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'да' : 'нет';
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'object') {
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('');
    }
    if ('text' in value && typeof value.text === 'string') {
      return value.text;
    }
    if ('result' in value) {
      return cellToText(value.result as ExcelJS.CellValue);
    }
    if ('error' in value) {
      return '';
    }
  }
  return '';
}

/**
 * Загружает книгу из байтов файла.
 *
 * Приведение типа собрано здесь: exceljs объявляет `Buffer` по-своему, а `@types/node` делает его
 * обобщённым, поэтому прямой вызов `load` не проходит проверку типов, хотя принимает те же байты.
 */
export async function loadWorkbook(data: ArrayBuffer | Uint8Array): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  return workbook;
}

/**
 * Читает первый лист книги как таблицу строк (номера строк и колонок — как в Excel).
 *
 * Пустые строки сохраняются: по ним парсер определяет номер строки в файле, чтобы
 * администратор нашёл ошибку глазами.
 */
export async function readXlsxTable(data: ArrayBuffer | Uint8Array): Promise<string[][]> {
  const workbook = await loadWorkbook(data);

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return [];
  }

  const table: string[][] = [];
  const lastRow = Math.max(sheet.rowCount, 1);
  const lastColumn = Math.max(sheet.columnCount, 1);

  for (let rowNumber = 1; rowNumber <= lastRow; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const cells: string[] = [];
    for (let columnNumber = 1; columnNumber <= lastColumn; columnNumber += 1) {
      cells.push(cellToText(row.getCell(columnNumber).value));
    }
    table.push(cells);
  }

  return table;
}

/**
 * Шаблон файла для администратора: лист с одними заголовками (примеры специально не кладутся —
 * иначе их загрузят как данные) и лист с правилами.
 */
export async function buildProductImportTemplate(): Promise<Uint8Array<ArrayBuffer>> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ProdTrack';
  workbook.created = new Date(0);

  const sheet = workbook.addWorksheet('Номенклатура');
  const headerRow = sheet.addRow(PRODUCT_IMPORT_COLUMNS.map((column) => column.header));
  headerRow.font = { bold: true };
  sheet.columns = PRODUCT_IMPORT_COLUMNS.map((column) => ({
    width: column.key === 'name' ? 40 : 22,
  }));
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  const help = workbook.addWorksheet('Инструкция');
  help.columns = [{ width: 24 }, { width: 14 }, { width: 70 }];
  help.addRow(['Загрузка номенклатуры из файла']).font = { bold: true, size: 14 };
  help.addRow([]);
  help.addRow([
    'Инструмент администратора: заполните лист «Номенклатура» и загрузите файл в справочнике номенклатуры.',
  ]);
  help.addRow([]);
  const tableHeader = help.addRow(['Колонка', 'Обязательна', 'Что указывать']);
  tableHeader.font = { bold: true };
  for (const column of PRODUCT_IMPORT_COLUMNS) {
    help.addRow([column.header, 'да', column.description]);
  }
  help.addRow([]);
  help.addRow(['Правила']).font = { bold: true };
  const rules = [
    'Файл — .xlsx (Excel 2007 и новее). Формат .xls и .csv не принимаются.',
    'Строка заголовков — первая непустая строка таблицы; колонки можно менять местами.',
    'Код уникален: повтор внутри файла и совпадение с существующим кодом — отдельные случаи (см. режим загрузки).',
    'Категория — «Масса» или «ГП». ПФ не отдельная категория: ПФ указывается при вводе факта для позиции ГП.',
    'Единица измерения — до ' + MAX_UNIT_LENGTH + ' символов (кг, л, шт, уп).',
    'Если код начинается с нуля, задайте колонке «Код» текстовый формат — Excel иначе убирает ведущие нули.',
    'В одном файле — не более ' + MAX_IMPORT_ROWS + ' строк с данными.',
    'Загрузка не возвращает в работу деактивированные позиции: признак активности импорт не меняет.',
    'Незнакомые колонки игнорируются — их список показывается при проверке файла.',
  ];
  for (const rule of rules) {
    help.addRow(['', '', rule]);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return toBytes(buffer);
}
