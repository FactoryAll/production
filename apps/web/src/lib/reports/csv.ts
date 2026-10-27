/**
 * Выгрузка отчётов в CSV для Excel (решение владельца 26.10.2026).
 *
 * Почему CSV, а не .xlsx: настоящий xlsx требует библиотеки, а ради форматирования
 * тянуть зависимость в проект не стали. Excel открывает такой файл двойным щелчком,
 * если выполнены два условия:
 *   1. BOM в начале — иначе кириллица превратится в кракозябры;
 *   2. разделитель `;` — на русской локали Excel ждёт именно его.
 */
export function toCsv(headers: string[], rows: Array<Array<string | number | null>>): string {
  const escape = (value: string | number | null): string => {
    if (value === null || value === undefined) {
      return '';
    }
    const text = String(value);
    return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const lines = [headers.map(escape).join(';'), ...rows.map((row) => row.map(escape).join(';'))];
  // BOM + CRLF: Excel на Windows понимает именно такую комбинацию.
  return '\uFEFF' + lines.join('\r\n');
}

/** Заголовки ответа для скачивания файла. */
export function csvHeaders(fileName: string): Record<string, string> {
  return {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${fileName}"`,
    'Cache-Control': 'no-store',
  };
}
