/**
 * Разбор выгрузки «полная спецификация (BOM)» из 1С — чистый модуль, без базы и без файлов.
 *
 * Что берём и что выбрасываем (решение владельца 19.11.2026):
 *   — из готовой продукции нужны только два компонента: **Масса** и **Туба**;
 *   — сырьё и упаковка (бутылка, крышка, этикетка, гофроящик и прочее) сейчас не нужны;
 *   — спецификации самих Масс и Туб (`Категория = «Масса»`, `«Сырьё»`) не читаем вовсе.
 *
 * Формат файла 1С (лист «Лист_1», подтверждено на `4-bom.xlsx` от 19.11.2026):
 *   Материал | Номенклатура | Доля | Категория | Код | Код материала
 * `Доля` для Массы — норма на единицу продукции: 1 л → 1.0, 100 мл → 0.088, 5 л → 4.7.
 *
 * Правило владельца «одна Масса на ГП» здесь же и проверяется: файл, в котором у ГП две
 * Массы, не загружается молча — он попадает в отчёт как противоречие.
 */

export const BOM_COLUMNS = {
  material: 0,
  product: 1,
  share: 2,
  category: 3,
  productCode: 4,
  materialCode: 5,
} as const;

/** Что вообще бывает в файле 1С. */
export type BomRowCategory = 'Продукция' | 'Масса' | 'Сырьё' | string;

/** Что из этого нам нужно. */
export type BomComponentKind = 'MASS' | 'TUBE';

export interface BomBinding {
  /** Номер строки в файле — по нему человек ищет позицию в Excel. */
  rowNumber: number;
  gpCode: string;
  gpName: string;
  componentCode: string;
  componentName: string;
  kind: BomComponentKind;
  /** Норма на единицу продукции (кг для Массы, шт для Тубы). */
  share: number;
}

export interface BomProductGroup {
  gpCode: string;
  gpName: string;
  mass?: BomBinding;
  tube?: BomBinding;
  /** Сколько прочих компонентов (упаковка, сырьё) пришлось на эту ГП. */
  otherComponents: number;
}

export interface BomParseResult {
  groups: BomProductGroup[];
  /** Строки, которые не удалось разобрать: пустой код, нулевая доля, дубль пары. */
  issues: string[];
  /** Сколько строк файла прочитано и сколько из них отброшено как ненужные. */
  stats: {
    rows: number;
    skippedNotProduct: number;
    skippedOtherComponent: number;
    massBindings: number;
    tubeBindings: number;
  };
}

/** Ошибка формата: лучше отказать, чем молча загрузить чужую структуру. */
export class BomFormatError extends Error {}

// Внимание: `\b` в JavaScript считает словом только латиницу и цифры, поэтому «Масса\b»
// не совпадало ни с одной русской строкой — проверено на реальном файле 19.11.2026
// (вместо 471 Массы находилось 261). Границу задаём явно: пробел, дефис или конец строки.
function looksLikeMass(name: string): boolean {
  return /^масса([\s_\-–—,.(]|$)/i.test(name.trim());
}

function looksLikeTube(name: string): boolean {
  // «Туба_М …» — рабочее имя тубы в 1С, подчёркивание здесь обязательный разделитель:
  // без него 15 привязок «ГП → Туба» терялись молча (поймано на реальном файле 19.11.2026).
  return /^туба([\s_\-–—,.(]|$)/i.test(name.trim());
}

/**
 * Тип компонента. Сначала — категория из нашего справочника (если код известен), потому что
 * имя в 1С можно поменять, а категория номенклатуры — наша. Для кодов, которых у нас нет
 * (а их много: 80 Масс и все Тубы), остаётся имя.
 */
export function componentKind(
  materialName: string,
  materialCode: string,
  catalogueCategory?: string,
): BomComponentKind | null {
  if (catalogueCategory === 'MASS' || looksLikeMass(materialName)) return 'MASS';
  if (looksLikeTube(materialName)) return 'TUBE';
  return null;
}

function parseShare(raw: string): number | null {
  // В 1С число может прийти с запятой вместо точки — в русской локали это норма.
  const normalized = raw.trim().replace(',', '.');
  if (normalized === '') return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/**
 * Разбирает строки листа в привязки «ГП → Масса» и «ГП → Туба».
 *
 * @param rows строки листа, включая строку заголовка
 * @param catalogueByCode категория номенклатуры по коду (то, что уже есть в ProdTrack)
 */
export function parseBom(
  rows: Array<{ rowNumber: number; cells: string[] }>,
  catalogueByCode: Map<string, { category: string }> = new Map(),
): BomParseResult {
  const header = rows.find((row) => row.cells.some((cell) => cell.trim() !== ''));
  if (!header) {
    throw new BomFormatError('Файл пуст: нет ни одной строки');
  }

  const headerCells = header.cells.map((cell) => cell.trim());
  const required = ['Материал', 'Номенклатура', 'Доля', 'Категория', 'Код', 'Код материала'];
  const missing = required.filter((title) => !headerCells.includes(title));
  if (missing.length > 0) {
    throw new BomFormatError(
      `Не тот файл: в заголовке нет столбцов ${missing.map((title) => `«${title}»`).join(', ')}. ` +
        'Ожидается выгрузка спецификаций 1С (Материал, Номенклатура, Доля, Категория, Код, Код материала)',
    );
  }

  // Индексы столбцов берём из заголовка, а не из позиции: 1С может переставить порядок.
  const column = (title: string) => headerCells.indexOf(title);
  const col = {
    material: column('Материал'),
    product: column('Номенклатура'),
    share: column('Доля'),
    category: column('Категория'),
    productCode: column('Код'),
    materialCode: column('Код материала'),
  };

  const groups = new Map<string, BomProductGroup>();
  const issues: string[] = [];
  const seenPairs = new Set<string>();
  const stats = { rows: 0, skippedNotProduct: 0, skippedOtherComponent: 0, massBindings: 0, tubeBindings: 0 };

  for (const row of rows) {
    if (row.rowNumber <= header.rowNumber) continue;
    const cells = row.cells;
    const productCode = (cells[col.productCode] ?? '').trim();
    const category = (cells[col.category] ?? '').trim();
    if (productCode === '' && category === '') continue; // пустая строка листа
    stats.rows += 1;

    // Спецификации самих Масс и Туб нам не нужны: Массу мы уже производим,
    // Тубу подключим отдельным производством позже.
    if (category !== 'Продукция') {
      stats.skippedNotProduct += 1;
      continue;
    }

    const materialName = (cells[col.material] ?? '').trim();
    const materialCode = (cells[col.materialCode] ?? '').trim();
    const gpName = (cells[col.product] ?? '').trim();

    if (!groups.has(productCode)) {
      groups.set(productCode, { gpCode: productCode, gpName, otherComponents: 0 });
    }
    const group = groups.get(productCode)!;

    const kind = componentKind(materialName, materialCode, catalogueByCode.get(materialCode)?.category);
    if (kind === null) {
      group.otherComponents += 1;
      stats.skippedOtherComponent += 1;
      continue;
    }

    const share = parseShare(cells[col.share] ?? '');
    if (share === null) {
      issues.push(
        `Строка ${row.rowNumber}: у «${materialName}» пустая или нулевая доля — без нормы привязку не загрузить`,
      );
      continue;
    }
    if (materialCode === '') {
      issues.push(`Строка ${row.rowNumber}: у компонента «${materialName}» нет кода — сопоставить нечем`);
      continue;
    }

    const pairKey = `${productCode}:${materialCode}`;
    if (seenPairs.has(pairKey)) {
      issues.push(
        `Строка ${row.rowNumber}: пара «${productCode} + ${materialCode}» повторяется в файле — оставлена первая`,
      );
      continue;
    }
    seenPairs.add(pairKey);

    const binding: BomBinding = {
      rowNumber: row.rowNumber,
      gpCode: productCode,
      gpName,
      componentCode: materialCode,
      componentName: materialName,
      kind,
      share,
    };

    if (kind === 'MASS') {
      // Правило владельца: одна Масса на ГП. Вторая Масса — противоречие в файле, а не повод
      // выбрать «какую-нибудь»: такая позиция уходит в отчёт и не загружается.
      if (group.mass) {
        issues.push(
          `Строка ${row.rowNumber}: у ГП ${productCode} уже есть Масса ${group.mass.componentCode}, ` +
            `а в файле указана ещё ${materialCode} — по правилу «одна Масса на ГП» строка не загружена`,
        );
        continue;
      }
      group.mass = binding;
      stats.massBindings += 1;
    } else {
      if (group.tube) {
        issues.push(
          `Строка ${row.rowNumber}: у ГП ${productCode} указано две Тубы (${group.tube.componentCode} и ${materialCode}) — оставлена первая`,
        );
        continue;
      }
      group.tube = binding;
      stats.tubeBindings += 1;
    }
  }

  return { groups: [...groups.values()], issues, stats };
}
