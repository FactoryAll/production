/**
 * Минимальный читатель .xlsx для файлов, которые выгружает 1С (BOM, спецификации).
 *
 * Почему не exceljs, которым работает импорт номенклатуры (`lib/nsi-import/xlsx.ts`):
 * выгрузка 1С содержит графику и комментарии (`xl/drawings/*`, `xl/comments1.xml`) и ломает
 * exceljs — «Cannot read properties of undefined (reading 'anchors')» на реальном файле
 * `4-bom.xlsx` (проверено 19.11.2026). Чинить чужую библиотеку под чужой формат мы не будем,
 * поэтому читаем сами — ровно то, что нужно: строки, столбцы, текст и числа.
 *
 * Здесь только ZIP и XML. Никаких зависимостей: разбор ZIP — штатным `node:zlib`.
 * Область сознательно узкая: один лист, значения ячеек, общий список строк. Формулы, стили,
 * объединённые ячейки и прочее не нужны и не читаются. Всё, что вне этого, обязано падать
 * с понятной ошибкой, а не подставлять пустоту.
 */

import { inflateRawSync } from 'node:zlib';

/** Подпись конца центрального каталога ZIP. */
const EOCD_SIGNATURE = 0x06054b50;
/** Подпись записи центрального каталога. */
const CENTRAL_SIGNATURE = 0x02014b50;
/** Подпись локального заголовка файла. */
const LOCAL_SIGNATURE = 0x04034b50;

export interface ZipEntries {
  /** Содержимое файлов архива по имени внутри архива. */
  read(name: string): Buffer | undefined;
  names(): string[];
}

/**
 * Разбирает ZIP-архив и отдаёт содержимое его файлов.
 *
 * Поддерживаются только два способа хранения — «без сжатия» и «deflate». Этого достаточно:
 * и 1С, и Excel, и LibreOffice пишут именно так.
 */
export function openZip(buffer: Buffer): ZipEntries {
  // Ищем конец центрального каталога: он в конце файла, но после него может быть комментарий
  // архива, поэтому идём с конца и допускаем хвост до 64 КБ (максимум комментария в формате).
  let eocd = -1;
  const start = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= start; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new Error('Файл не похож на .xlsx: не найден конец архива (это не ZIP)');
  }

  const totalEntries = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);

  const entries = new Map<string, { method: number; compressedSize: number; localOffset: number }>();

  for (let index = 0; index < totalEntries; index += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error('Файл повреждён: центральный каталог архива читается не по формату');
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);

    entries.set(name, { method, compressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  function read(name: string): Buffer | undefined {
    const entry = entries.get(name);
    if (!entry) return undefined;
    const local = entry.localOffset;
    if (buffer.readUInt32LE(local) !== LOCAL_SIGNATURE) {
      throw new Error(`Файл повреждён: заголовок «${name}» читается не по формату`);
    }
    const nameLength = buffer.readUInt16LE(local + 26);
    const extraLength = buffer.readUInt16LE(local + 28);
    const dataStart = local + 30 + nameLength + extraLength;
    const raw = buffer.subarray(dataStart, dataStart + entry.compressedSize);
    if (entry.method === 0) return Buffer.from(raw);
    if (entry.method === 8) return inflateRawSync(raw);
    throw new Error(`Файл сжат способом ${entry.method}, который не поддерживается`);
  }

  return { read, names: () => [...entries.keys()] };
}

/** Распаковка XML-сущностей: `&amp;`, `&lt;`, `&#171;` и подобные. */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Текст одного `<si>` (ячейки общего списка строк) — куски rich-text склеиваются. */
function readSharedString(xml: string): string {
  const parts: string[] = [];
  const runPattern = /<t[^>]*>([\s\S]*?)<\/t>/g;
  let match = runPattern.exec(xml);
  while (match) {
    parts.push(decodeXmlEntities(match[1]));
    match = runPattern.exec(xml);
  }
  return parts.join('');
}

/**
 * Атрибуты XML-элемента без зависимости от их порядка.
 *
 * Порядок атрибутов в файле не задан форматом: 1С пишет `Id` перед `Target`, openpyxl —
 * наоборот. Регулярка, ждущая фиксированный порядок, ломается на чужом писателе
 * (поймано тестом на фикстуре openpyxl 19.11.2026).
 */
function readAttribute(element: string, name: string): string | undefined {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`);
  return pattern.exec(element)?.[1];
}

/** Буквы столбца («A», «AA») в номер с нуля. */
function columnIndex(reference: string): number {
  const letters = reference.replace(/[^A-Z]/g, '');
  let value = 0;
  for (const letter of letters) {
    value = value * 26 + (letter.charCodeAt(0) - 64);
  }
  return value - 1;
}

export interface SheetRow {
  /** Номер строки в файле, с 1 — по нему человек ищет проблему в Excel. */
  rowNumber: number;
  /** Текстовые значения ячеек по индексу столбца; пустая ячейка — пустая строка. */
  cells: string[];
}

/**
 * Читает первый лист книги: `sharedStrings` + `worksheets/sheetN.xml`.
 * Возвращает строки в порядке файла, значения — строками (числа тоже строкой).
 */
export function readFirstSheet(buffer: Buffer): SheetRow[] {
  const zip = openZip(buffer);

  const workbook = zip.read('xl/workbook.xml');
  const workbookRels = zip.read('xl/_rels/workbook.xml.rels');
  if (!workbook || !workbookRels) {
    throw new Error('Файл не похож на книгу Excel: нет xl/workbook.xml');
  }

  // Первый лист книги: по порядку в <sheets>. Ссылку на файл листа ищем в отношениях,
  // чтобы не угадывать имя `sheet1.xml` — 1С пишет именно так, но полагаться на это нельзя.
  const sheetsXml = workbook.toString('utf8');
  const sheetElements = sheetsXml.match(/<sheet\b[^>]*\/>/g) ?? [];
  const relationId = sheetElements.map((element) => readAttribute(element, 'r:id')).find(Boolean);
  if (!relationId) {
    throw new Error('В книге нет ни одного листа');
  }

  const relsXml = workbookRels.toString('utf8');
  const relationElements = relsXml.match(/<Relationship\b[^>]*\/>/g) ?? [];
  const target = relationElements
    .filter((element) => readAttribute(element, 'Id') === relationId)
    .map((element) => readAttribute(element, 'Target'))
    .find(Boolean);
  if (!target) {
    throw new Error('Не удалось найти файл первого листа в книге');
  }
  const sheetPath = `xl/${target.replace(/^\/?xl\//, '').replace(/^\.\//, '')}`;
  const sheetXml = zip.read(sheetPath);
  if (!sheetXml) {
    throw new Error(`В архиве нет файла листа «${sheetPath}»`);
  }

  const sharedXml = zip.read('xl/sharedStrings.xml')?.toString('utf8') ?? '';
  const sharedStrings: string[] = [];
  if (sharedXml) {
    const sharedPattern = /<si>([\s\S]*?)<\/si>/g;
    let sharedMatch = sharedPattern.exec(sharedXml);
    while (sharedMatch) {
      sharedStrings.push(readSharedString(sharedMatch[1]));
      sharedMatch = sharedPattern.exec(sharedXml);
    }
  }

  const rows: SheetRow[] = [];
  const rowPattern = /<row\b[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch = rowPattern.exec(sheetXml.toString('utf8'));
  while (rowMatch) {
    const rowNumber = Number(rowMatch[1]);
    const cells: string[] = [];
    const cellPattern = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g;
    let cellMatch = cellPattern.exec(rowMatch[2]);
    while (cellMatch) {
      const attributes = cellMatch[1] ?? cellMatch[3] ?? '';
      const body = cellMatch[2] ?? '';
      const reference = readAttribute(attributes, 'r');
      const type = readAttribute(attributes, 't');
      const index = reference ? columnIndex(reference) : cells.length;

      let value = '';
      if (type === 's') {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        value = raw === undefined ? '' : (sharedStrings[Number(raw)] ?? '');
      } else if (type === 'inlineStr') {
        value = readSharedString(body);
      } else {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        value = raw === undefined ? '' : decodeXmlEntities(raw);
      }

      while (cells.length < index) cells.push('');
      cells[index] = value;
      cellMatch = cellPattern.exec(rowMatch[2]);
    }
    rows.push({ rowNumber, cells });
    rowMatch = rowPattern.exec(sheetXml.toString('utf8'));
  }

  return rows;
}
