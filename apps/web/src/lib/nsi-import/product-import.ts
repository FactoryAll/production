// Импорт номенклатуры из файла .xlsx (этап 5, задание владельца 12.10.2026).
//
// Модуль чистый: ни базы, ни exceljs — на входе таблица строк, на выходе проверенные строки.
// Структура колонок объявлена здесь один раз и используется парсером, шаблоном файла и подсказкой
// в интерфейсе, поэтому они не могут разойтись.

import { ProductCategory } from '@prodtrack/contracts';

export type ProductImportColumnKey = 'code' | 'name' | 'category' | 'unit';

export interface ProductImportColumn {
  key: ProductImportColumnKey;
  header: string;
  /** Варианты заголовка, принимаемые наравне с основным: регистр, пробелы и точки не важны. */
  aliases: string[];
  required: true;
  description: string;
}

export const PRODUCT_IMPORT_COLUMNS: ProductImportColumn[] = [
  {
    key: 'code',
    header: 'Код',
    aliases: ['код номенклатуры', 'артикул', 'sku'],
    required: true,
    description: 'Уникальный код позиции, например GP001',
  },
  {
    key: 'name',
    header: 'Наименование',
    aliases: ['название', 'наименование номенклатуры', 'номенклатура'],
    required: true,
    description: 'Название позиции',
  },
  {
    key: 'category',
    header: 'Категория',
    aliases: ['категория продукции', 'тип', 'вид'],
    required: true,
    description: 'Масса или ГП',
  },
  {
    key: 'unit',
    header: 'Единица измерения',
    aliases: ['единица', 'еи', 'ед изм', 'единица изм'],
    required: true,
    description: 'кг, л, шт, уп — до 20 символов',
  },
];

/** Предел объёма одного файла: защита от случайной загрузки выгрузки целиком. */
export const MAX_IMPORT_ROWS = 2000;

/** Предел размера файла: server action принимает до 10 МБ (см. apps/web/next.config.js). */
export const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;

/** Сколько строк и ошибок показывать в отчёте о проверке файла. */
export const PREVIEW_ROWS = 20;
export const MAX_CODE_LENGTH = 200;
export const MAX_NAME_LENGTH = 200;
export const MAX_UNIT_LENGTH = 20;

export interface ParsedProductRow {
  /** Номер строки в файле (как в Excel, с единицы) — чтобы администратор нашёл её глазами. */
  rowNumber: number;
  code: string;
  name: string;
  category: ProductCategory;
  unit: string;
}

export interface ProductImportRowError {
  rowNumber: number;
  messages: string[];
}

export interface ProductImportParseResult {
  /** Заполняется, когда файл нельзя разобрать целиком (нет колонок, превышен объём). */
  fatalError: string | null;
  missingHeaders: string[];
  ignoredHeaders: string[];
  rows: ParsedProductRow[];
  errors: ProductImportRowError[];
}

const MASS_VALUES = ['масса', 'массы', 'массу', 'mass'];
const GP_VALUES = ['гп', 'готовая продукция', 'готовой продукции', 'gp'];
const SEMI_FINISHED_VALUES = ['пф', 'полуфабрикат', 'полуфабрикаты', 'полуфабриката'];

/** Убирает неразрывные пробелы, лишние пробелы по краям и внутри значения. */
export function normalizeValue(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Заголовок колонки приводится к сравнимому виду: регистр, точки, звёздочки и пробелы не важны. */
export function normalizeHeader(value: string): string {
  return normalizeValue(value)
    .toLowerCase()
    .replace(/[.*:]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function columnByHeader(header: string): ProductImportColumn | null {
  const normalized = normalizeHeader(header);
  if (!normalized) {
    return null;
  }
  for (const column of PRODUCT_IMPORT_COLUMNS) {
    if (normalizeHeader(column.header) === normalized) {
      return column;
    }
    if (column.aliases.some((alias) => normalizeHeader(alias) === normalized)) {
      return column;
    }
  }
  return null;
}

/** «Масса», «ГП» и их синонимы → категория системы. Непонятное значение → null. */
export function parseProductCategory(value: string): ProductCategory | null {
  const normalized = normalizeValue(value).toLowerCase();
  if (MASS_VALUES.includes(normalized)) {
    return ProductCategory.MASS;
  }
  if (GP_VALUES.includes(normalized)) {
    return ProductCategory.GP;
  }
  return null;
}

/** Значение похоже на «ПФ» — частая ошибка: ПФ не отдельная категория (M01 BR-2). */
export function looksLikeSemiFinished(value: string): boolean {
  return SEMI_FINISHED_VALUES.includes(normalizeValue(value).toLowerCase());
}

interface HeaderMatch {
  rowIndex: number;
  /** Колонка файла (0-based) для каждой найденной колонки таблицы. */
  indexes: Map<ProductImportColumnKey, number>;
  ignoredHeaders: string[];
}

const HEADER_SEARCH_ROWS = 10;

/**
 * Ищет строку заголовков: в реальных файлах над таблицей бывает строка-название,
 * поэтому просматриваются первые строки, а не только первая.
 */
function findHeaderRow(table: string[][]): HeaderMatch | null {
  const limit = Math.min(table.length, HEADER_SEARCH_ROWS);
  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const row = table[rowIndex] ?? [];
    const indexes = new Map<ProductImportColumnKey, number>();
    const ignoredHeaders: string[] = [];

    row.forEach((cell, index) => {
      const column = columnByHeader(cell);
      if (column) {
        if (!indexes.has(column.key)) {
          indexes.set(column.key, index);
        }
        return;
      }
      if (normalizeValue(cell)) {
        ignoredHeaders.push(normalizeValue(cell));
      }
    });

    if (indexes.size >= 2) {
      return { rowIndex, indexes, ignoredHeaders };
    }
  }
  return null;
}

/**
 * Разбирает таблицу файла в проверенные строки номенклатуры.
 *
 * Проверяются все строки сразу: администратор видит весь список ошибок с номерами строк,
 * а не по одной. Строки с ошибками в базу не попадают — импорт применяется целиком или не применяется.
 */
export function parseProductImportTable(table: string[][]): ProductImportParseResult {
  const empty: ProductImportParseResult = {
    fatalError: null,
    missingHeaders: [],
    ignoredHeaders: [],
    rows: [],
    errors: [],
  };

  const header = findHeaderRow(table);
  if (!header) {
    return {
      ...empty,
      fatalError:
        'В файле не найдена строка заголовков. Ожидаются колонки: ' +
        PRODUCT_IMPORT_COLUMNS.map((column) => column.header).join(', ') +
        '. Скачайте шаблон и заполните его.',
      missingHeaders: PRODUCT_IMPORT_COLUMNS.map((column) => column.header),
    };
  }

  const missingHeaders = PRODUCT_IMPORT_COLUMNS.filter(
    (column) => !header.indexes.has(column.key),
  ).map((column) => column.header);

  if (missingHeaders.length > 0) {
    return {
      ...empty,
      fatalError: 'В файле нет обязательных колонок: ' + missingHeaders.join(', '),
      missingHeaders,
      ignoredHeaders: header.ignoredHeaders,
    };
  }

  const dataRows = table.slice(header.rowIndex + 1).filter((row) =>
    row.some((cell) => normalizeValue(cell ?? '')),
  );

  if (dataRows.length > MAX_IMPORT_ROWS) {
    return {
      ...empty,
      fatalError:
        'В файле ' +
        dataRows.length +
        ' строк с данными — больше предела ' +
        MAX_IMPORT_ROWS +
        '. Разделите файл на части.',
      missingHeaders,
      ignoredHeaders: header.ignoredHeaders,
    };
  }

  const rows: ParsedProductRow[] = [];
  const errors: ProductImportRowError[] = [];
  const codeRows = new Map<string, number>();

  table.slice(header.rowIndex + 1).forEach((row, offset) => {
    const rowNumber = header.rowIndex + offset + 2;
    if (!row.some((cell) => normalizeValue(cell ?? ''))) {
      return;
    }

    const value = (key: ProductImportColumnKey): string =>
      normalizeValue(row[header.indexes.get(key) as number] ?? '');

    const code = value('code');
    const name = value('name');
    const rawCategory = value('category');
    const unit = value('unit');
    const messages: string[] = [];

    if (!code) {
      messages.push('Не указан код');
    } else if (code.length > MAX_CODE_LENGTH) {
      messages.push('Код длиннее ' + MAX_CODE_LENGTH + ' символов — проверьте, не сдвинулись ли колонки');
    }

    if (!name) {
      messages.push('Не указано наименование');
    } else if (name.length > MAX_NAME_LENGTH) {
      messages.push('Наименование длиннее ' + MAX_NAME_LENGTH + ' символов — проверьте, не сдвинулись ли колонки');
    }

    let category: ProductCategory | null = null;
    if (!rawCategory) {
      messages.push('Не указана категория');
    } else {
      category = parseProductCategory(rawCategory);
      if (!category) {
        messages.push(
          looksLikeSemiFinished(rawCategory)
            ? 'ПФ — не отдельная категория: ПФ указывается при вводе факта для позиции ГП (M01 BR-2). Укажите «Масса» или «ГП»'
            : 'Категория «' + rawCategory + '» не распознана. Допустимо: Масса или ГП',
        );
      }
    }

    if (!unit) {
      messages.push('Не указана единица измерения');
    } else if (unit.length > MAX_UNIT_LENGTH) {
      messages.push('Единица измерения не может превышать ' + MAX_UNIT_LENGTH + ' символов');
    }

    if (code) {
      const firstRow = codeRows.get(code.toLowerCase());
      if (firstRow !== undefined) {
        messages.push('Код повторяется в файле (строка ' + firstRow + ')');
      } else {
        codeRows.set(code.toLowerCase(), rowNumber);
      }
    }

    if (messages.length > 0 || !category) {
      errors.push({ rowNumber, messages });
      return;
    }

    rows.push({ rowNumber, code, name, category, unit });
  });

  return {
    fatalError: null,
    missingHeaders: [],
    ignoredHeaders: header.ignoredHeaders,
    rows,
    errors,
  };
}
