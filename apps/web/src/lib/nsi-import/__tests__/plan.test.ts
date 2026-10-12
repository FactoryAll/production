import { describe, it, expect } from 'vitest';
import { ProductCategory } from '@prodtrack/contracts';
import { buildImportPlan, type ExistingProduct } from '../plan';
import type { ParsedProductRow } from '../product-import';

function row(code: string, name: string, unit = 'шт'): ParsedProductRow {
  return { rowNumber: 2, code, name, category: ProductCategory.GP, unit };
}

const existing: ExistingProduct = {
  id: 'p-1',
  code: 'GP001',
  name: 'Крем А',
  category: 'GP',
  unit: 'шт',
  active: true,
};

describe('План загрузки номенклатуры', () => {
  it('в режиме «только добавлять» пропускает совпавший код', () => {
    const plan = buildImportPlan([row('GP001', 'Крем А'), row('GP002', 'Крем Б')], [existing], 'add-only');

    expect(plan.counts).toEqual({ create: 1, update: 0, unchanged: 0, skip: 1, errors: 0 });
    expect(plan.items[0].action).toBe('skip');
    expect(plan.items[0].reason).toContain('уже есть в справочнике');
    expect(plan.items[1].action).toBe('create');
  });

  it('в режиме обновления показывает, какие поля изменятся', () => {
    const plan = buildImportPlan(
      [row('GP001', 'Крем А улучшенный', 'кг')],
      [existing],
      'upsert',
    );

    expect(plan.items[0].action).toBe('update');
    expect(plan.items[0].changes).toEqual(['наименование', 'единица измерения']);
    expect(plan.counts.update).toBe(1);
  });

  it('не переписывает позицию, полностью совпавшую с файлом', () => {
    const plan = buildImportPlan([row('GP001', 'Крем А')], [existing], 'upsert');

    expect(plan.items[0].action).toBe('unchanged');
    expect(plan.counts).toEqual({ create: 0, update: 0, unchanged: 1, skip: 0, errors: 0 });
  });

  it('не возвращает деактивированную позицию в работу: активности в изменениях нет', () => {
    const plan = buildImportPlan(
      [row('GP001', 'Крем А новый')],
      [{ ...existing, active: false }],
      'upsert',
    );

    expect(plan.items[0].action).toBe('update');
    expect(plan.items[0].changes).toEqual(['наименование']);
    expect(plan.items[0].existing?.active).toBe(false);
  });

  it('учитывает строки с ошибками в общем числе строк файла', () => {
    const plan = buildImportPlan([row('GP002', 'Крем Б')], [existing], 'add-only', 3);

    expect(plan.counts.errors).toBe(3);
    expect(plan.totalRows).toBe(4);
  });

  it('на пустом файле даёт пустой план', () => {
    const plan = buildImportPlan([], [existing], 'upsert');

    expect(plan.items).toEqual([]);
    expect(plan.totalRows).toBe(0);
  });
});
