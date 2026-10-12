// План импорта номенклатуры: что будет создано, обновлено или пропущено (этап 5).
//
// Чистый модуль: сравнение разобранных строк файла с текущим справочником. Отдельный шаг нужен,
// чтобы администратор увидел последствия загрузки до её применения.

import type { ProductCategory } from '@prodtrack/contracts';
import type { ParsedProductRow } from './product-import';

export type ProductImportMode = 'add-only' | 'upsert';

export type ImportRowAction = 'create' | 'update' | 'unchanged' | 'skip';

export interface ExistingProduct {
  id: string;
  code: string;
  name: string;
  category: string;
  unit: string;
  active: boolean;
}

export interface ImportPlanItem {
  rowNumber: number;
  code: string;
  name: string;
  category: ProductCategory;
  unit: string;
  action: ImportRowAction;
  /** Почему строка пропускается или не изменяется — текст для администратора. */
  reason?: string;
  /** Какие поля изменятся (только для action = update). */
  changes?: string[];
  /** Текущие данные позиции (только для action = update). */
  existing?: ExistingProduct;
}

export interface ImportPlanCounts {
  create: number;
  update: number;
  unchanged: number;
  skip: number;
  errors: number;
}

export interface ImportPlan {
  items: ImportPlanItem[];
  counts: ImportPlanCounts;
  totalRows: number;
  mode: ProductImportMode;
}

const FIELD_LABELS: Record<'name' | 'category' | 'unit', string> = {
  name: 'наименование',
  category: 'категория',
  unit: 'единица измерения',
};

function changedFields(
  row: ParsedProductRow,
  existing: ExistingProduct,
): ('name' | 'category' | 'unit')[] {
  const changes: ('name' | 'category' | 'unit')[] = [];
  if (row.name !== existing.name) {
    changes.push('name');
  }
  if (row.category !== existing.category) {
    changes.push('category');
  }
  if (row.unit !== existing.unit) {
    changes.push('unit');
  }
  return changes;
}

/**
 * Строит план загрузки.
 *
 * Режим «только добавлять» бережёт уже заведённые позиции: совпавший код пропускается.
 * Режим «добавлять и обновлять» меняет наименование, категорию и единицу измерения, но
 * **не трогает признак активности** — импорт не возвращает в работу деактивированную номенклатуру.
 * Позиция, полностью совпавшая с файлом, не переписывается: в журнал не попадает «изменение без изменения».
 */
export function buildImportPlan(
  rows: ParsedProductRow[],
  existingProducts: ExistingProduct[],
  mode: ProductImportMode,
  errorCount = 0,
): ImportPlan {
  const byCode = new Map(existingProducts.map((product) => [product.code.toLowerCase(), product]));
  const items: ImportPlanItem[] = [];

  for (const row of rows) {
    const existing = byCode.get(row.code.toLowerCase());

    if (!existing) {
      items.push({
        rowNumber: row.rowNumber,
        code: row.code,
        name: row.name,
        category: row.category,
        unit: row.unit,
        action: 'create',
      });
      continue;
    }

    if (mode === 'add-only') {
      items.push({
        rowNumber: row.rowNumber,
        code: row.code,
        name: row.name,
        category: row.category,
        unit: row.unit,
        action: 'skip',
        reason: 'Код уже есть в справочнике — позиция не изменяется',
        existing,
      });
      continue;
    }

    const changes = changedFields(row, existing);
    if (changes.length === 0) {
      items.push({
        rowNumber: row.rowNumber,
        code: row.code,
        name: row.name,
        category: row.category,
        unit: row.unit,
        action: 'unchanged',
        reason: 'Данные совпадают с текущими',
        existing,
      });
      continue;
    }

    items.push({
      rowNumber: row.rowNumber,
      code: row.code,
      name: row.name,
      category: row.category,
      unit: row.unit,
      action: 'update',
      changes: changes.map((field) => FIELD_LABELS[field]),
      existing,
    });
  }

  return {
    items,
    counts: {
      create: items.filter((item) => item.action === 'create').length,
      update: items.filter((item) => item.action === 'update').length,
      unchanged: items.filter((item) => item.action === 'unchanged').length,
      skip: items.filter((item) => item.action === 'skip').length,
      errors: errorCount,
    },
    totalRows: items.length + errorCount,
    mode,
  };
}
