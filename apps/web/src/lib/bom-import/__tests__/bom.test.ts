import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readFirstSheet } from '../xlsx';
import { parseBom, BomFormatError, componentKind } from '../bom';
import { buildBomPlan, describeBomPlan } from '../plan';

const FIXTURE = join(__dirname, 'fixtures', 'mini-bom.xlsx');

function rows(header: string[], body: Array<Array<string | number>>) {
  return [
    { rowNumber: 1, cells: header },
    ...body.map((cells, index) => ({
      rowNumber: index + 2,
      cells: cells.map((cell) => String(cell)),
    })),
  ];
}

const HEADER = ['Материал', 'Номенклатура', 'Доля', 'Категория', 'Код', 'Код материала'];

describe('чтение файла 1С (xlsx без exceljs)', () => {
  it('читает лист и отдаёт заголовок и строки', () => {
    const sheet = readFirstSheet(readFileSync(FIXTURE));
    expect(sheet[0].cells.slice(0, 6)).toEqual(HEADER);
    expect(sheet.length).toBeGreaterThan(3);
  });

  it('на не-zip файле падает понятной ошибкой', () => {
    expect(() => readFirstSheet(Buffer.from('это не xlsx'))).toThrow(/не похож на \.xlsx/);
  });
});

describe('разбор BOM: что берём и что выбрасываем (19.11.2026)', () => {
  it('оставляет только Массу и Тубу у готовой продукции', () => {
    const parsed = parseBom(readFirstSheet(readFileSync(FIXTURE)));
    expect(parsed.groups).toHaveLength(2);

    const first = parsed.groups.find((group) => group.gpCode === 'GP-1')!;
    expect(first.mass?.componentCode).toBe('MASS-1');
    expect(first.mass?.share).toBe(1);
    expect(first.tube?.componentCode).toBe('TUBE-1');
    // Упаковка (бутылка) отброшена: она нам сейчас не нужна.
    expect(first.otherComponents).toBe(1);
    // Спецификации самой Массы и Тубы (категории «Масса» и «Сырьё») не читаются вовсе.
    expect(parsed.stats.skippedNotProduct).toBe(2);
  });

  it('узнаёт «Туба_М …» — рабочее имя тубы в 1С', () => {
    expect(componentKind('Туба_М GECO Гель дезинфицирующий', '00-00004928')).toBe('TUBE');
    expect(componentKind('Туба GECO Крем, 100 мл', '00-00001367')).toBe('TUBE');
    // Регресс: `\b` в JavaScript не работает с кириллицей, и «Масса Средство…» не находилось.
    expect(componentKind('Масса Средство для мытья посуды', '00-00000782')).toBe('MASS');
    expect(componentKind('Масса_Крем', 'X')).toBe('MASS');
    expect(componentKind('Бутылка, 1 л', '00-00002356')).toBeNull();
  });

  it('категория из нашего справочника важнее имени', () => {
    // Имя не похоже на Массу, но в номенклатуре ProdTrack этот код — «Масса».
    expect(componentKind('Композиция А', '00-00000123', 'MASS')).toBe('MASS');
  });

  it('вторая Масса у одной ГП — противоречие, а не повод выбрать одну наугад', () => {
    const parsed = parseBom(
      rows(HEADER, [
        ['Масса Первая', 'Крем, 1 л', 1, 'Продукция', 'GP-1', 'MASS-1'],
        ['Масса Вторая', 'Крем, 1 л', 1, 'Продукция', 'GP-1', 'MASS-2'],
      ]),
    );
    expect(parsed.groups[0].mass?.componentCode).toBe('MASS-1');
    expect(parsed.issues.join(' ')).toContain('одна Масса на ГП');
  });

  it('нулевая доля не превращается в привязку без нормы', () => {
    const parsed = parseBom(
      rows(HEADER, [
        ['Масса Крем', 'Крем, 1 л', 0, 'Продукция', 'GP-1', 'MASS-1'],
      ]),
    );
    expect(parsed.groups[0].mass).toBeUndefined();
    expect(parsed.issues.join(' ')).toContain('пустая или нулевая доля');
  });

  it('запятую в доле читает как десятичный разделитель', () => {
    const parsed = parseBom(
      rows(HEADER, [['Масса Крем', 'Крем, 100 мл', '0,088', 'Продукция', 'GP-1', 'MASS-1']]),
    );
    expect(parsed.groups[0].mass?.share).toBeCloseTo(0.088);
  });

  it('чужой файл не принимается молча', () => {
    expect(() => parseBom(rows(['Колонка', 'Другая'], []))).toThrow(BomFormatError);
    expect(() => parseBom(rows(['Колонка', 'Другая'], []))).toThrow(/Ожидается выгрузка спецификаций 1С/);
  });
});

describe('план загрузки: что привяжется и что останется без привязки', () => {
  const catalogue = [
    { code: 'GP-1', name: 'Крем, 1 л', category: 'GP', active: true },
    { code: 'GP-2', name: 'Гель, 5 л', category: 'GP', active: true },
    { code: 'GP-3', name: 'Мыло, 1 л', category: 'GP', active: true },
    { code: 'GP-4', name: 'Старый крем', category: 'GP', active: false },
    { code: 'MASS-1', name: 'Масса Крем', category: 'MASS', active: true },
    { code: 'MASS-2', name: 'Масса Гель', category: 'MASS', active: true },
  ];

  it('привязывает только то, что есть в номенклатуре с верными категориями', () => {
    const parsed = parseBom(
      rows(HEADER, [
        ['Масса Крем', 'Крем, 1 л', 1, 'Продукция', 'GP-1', 'MASS-1'],
        ['Масса Гель', 'Гель, 5 л', 5, 'Продукция', 'GP-2', 'MASS-2'],
        ['Масса Неизвестная', 'Неизвестный крем, 1 л', 1, 'Продукция', 'GP-9', 'MASS-9'],
        ['Масса Крем', 'Старый крем, 1 л', 1, 'Продукция', 'GP-4', 'MASS-1'],
      ]),
    );
    const plan = buildBomPlan(parsed, catalogue);

    expect(plan.counts.bind).toBe(2);
    expect(plan.bind.map((item) => item.gpCode).sort()).toEqual(['GP-1', 'GP-2']);
    expect(plan.skip.map((item) => item.reason).join(' ')).toContain('ГП нет в номенклатуре');
    expect(plan.skip.map((item) => item.reason).join(' ')).toContain('деактивирована');
  });

  it('ГП справочника, которых нет в файле, попадают в рабочий список, а не в удаление', () => {
    const parsed = parseBom(
      rows(HEADER, [['Масса Крем', 'Крем, 1 л', 1, 'Продукция', 'GP-1', 'MASS-1']]),
    );
    const plan = buildBomPlan(parsed, catalogue);

    expect(plan.absentFromFile.map((entry) => entry.code)).toEqual(['GP-2', 'GP-3']);
    expect(describeBomPlan(plan, parsed.issues)).toContain('ГП справочника, которых нет в файле');
  });

  it('ГП без Массы в файле видны отдельно', () => {
    const parsed = parseBom(
      rows(HEADER, [['Бутылка, 1 л', 'Крем без массы, 1 л', 1, 'Продукция', 'GP-1', 'PACK-1']]),
    );
    const plan = buildBomPlan(parsed, catalogue);
    expect(plan.counts.withoutMassInFile).toBe(1);
    expect(plan.withoutMassInFile[0].reason).toContain('нет компонента «Масса»');
  });
});
