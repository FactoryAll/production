import { describe, it, expect } from 'vitest';
import {
  MAX_IMPORT_ROWS,
  parseProductImportTable,
  parseProductCategory,
  looksLikeSemiFinished,
} from '../product-import';

const HEADERS = ['Код', 'Наименование', 'Категория', 'Единица измерения'];

function table(...rows: string[][]): string[][] {
  return [HEADERS, ...rows];
}

describe('Разбор файла загрузки номенклатуры', () => {
  it('читает строки с колонками в любом порядке', () => {
    const result = parseProductImportTable([
      ['Наименование', 'Единица измерения', 'Код', 'Категория'],
      ['Масса базовая', 'кг', 'MASS001', 'Масса'],
    ]);

    expect(result.fatalError).toBeNull();
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      { rowNumber: 2, code: 'MASS001', name: 'Масса базовая', category: 'MASS', unit: 'кг' },
    ]);
  });

  it('пропускает строку-название над таблицей и определяет номера строк как в Excel', () => {
    const result = parseProductImportTable([
      ['Список номенклатуры на 12.10.2026'],
      HEADERS,
      ['GP001', 'Крем А', 'ГП', 'шт'],
      [],
      ['GP002', 'Крем Б', 'ГП', 'шт'],
    ]);

    expect(result.rows.map((row) => row.rowNumber)).toEqual([3, 5]);
    expect(result.rows.map((row) => row.code)).toEqual(['GP001', 'GP002']);
  });

  it('понимает синонимы заголовков и сообщает о незнакомых колонках', () => {
    const result = parseProductImportTable([
      ['Артикул', 'Название', 'Тип', 'ЕИ', 'Код 1С'],
      ['GP010', 'Крем В', 'ГП', 'шт', '00-000123'],
    ]);

    expect(result.fatalError).toBeNull();
    expect(result.ignoredHeaders).toEqual(['Код 1С']);
    expect(result.rows[0].code).toBe('GP010');
  });

  it('без строки заголовков не разбирает файл', () => {
    const result = parseProductImportTable([['что-то'], ['ещё что-то']]);

    expect(result.fatalError).toContain('не найдена строка заголовков');
    expect(result.rows).toEqual([]);
  });

  it('перечисляет отсутствующие обязательные колонки', () => {
    const result = parseProductImportTable([
      ['Код', 'Наименование'],
      ['GP001', 'Крем А'],
    ]);

    expect(result.fatalError).toContain('Категория');
    expect(result.fatalError).toContain('Единица измерения');
    expect(result.missingHeaders).toEqual(['Категория', 'Единица измерения']);
  });

  it('принимает «Масса» и «ГП» в разных написаниях', () => {
    expect(parseProductCategory('Масса')).toBe('MASS');
    expect(parseProductCategory(' массы ')).toBe('MASS');
    expect(parseProductCategory('MASS')).toBe('MASS');
    expect(parseProductCategory('ГП')).toBe('GP');
    expect(parseProductCategory('готовая продукция')).toBe('GP');
    expect(parseProductCategory('GP')).toBe('GP');
    expect(parseProductCategory('прочее')).toBeNull();
  });

  it('объясняет, что ПФ — не категория номенклатуры (M01 BR-2)', () => {
    const result = parseProductImportTable(table(['GP003', 'Крем Г', 'ПФ', 'шт']));

    expect(looksLikeSemiFinished('пф')).toBe(true);
    expect(result.rows).toEqual([]);
    expect(result.errors[0].rowNumber).toBe(2);
    expect(result.errors[0].messages[0]).toContain('ПФ — не отдельная категория');
  });

  it('сообщает обо всех пустых обязательных полях строки сразу', () => {
    const result = parseProductImportTable(table(['', '', '', '']));

    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([]);

    const withValues = parseProductImportTable(table(['GP004', '', '', 'шт']));
    expect(withValues.errors[0].messages).toEqual(['Не указано наименование', 'Не указана категория']);
  });

  it('ловит повтор кода внутри файла и указывает первую строку', () => {
    const result = parseProductImportTable(
      table(['GP005', 'Крем Д', 'ГП', 'шт'], ['gp005', 'Крем Д дубль', 'ГП', 'шт']),
    );

    expect(result.rows).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].rowNumber).toBe(3);
    expect(result.errors[0].messages[0]).toBe('Код повторяется в файле (строка 2)');
  });

  it('ограничивает длину единицы измерения как форма справочника', () => {
    const result = parseProductImportTable(table(['GP006', 'Крем Е', 'ГП', 'килограммов очень много']));

    expect(result.rows).toEqual([]);
    expect(result.errors[0].messages[0]).toContain('не может превышать 20 символов');
  });

  it('не принимает файл больше предела строк', () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, index) => [
      'GP' + index,
      'Позиция ' + index,
      'ГП',
      'шт',
    ]);

    const result = parseProductImportTable(table(...rows));

    expect(result.fatalError).toContain('больше предела ' + MAX_IMPORT_ROWS);
    expect(result.rows).toEqual([]);
  });

  it('на пустом файле с заголовками не находит ошибок', () => {
    const result = parseProductImportTable(table());

    expect(result.fatalError).toBeNull();
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});
