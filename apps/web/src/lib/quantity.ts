/**
 * Отображение количества (решение владельца 23.10.2026, ОПЭ-32).
 *
 * Количество в системе — целое число, поэтому на экранах оно печатается без хвоста
 * «.00»: «2592», а не «2592.00». Дробные значения остались только в старых данных,
 * их показываем как есть, чтобы не выдавать одно за другое.
 */
export function formatQuantity(value: number | string | { toString(): string }): string {
  const raw = typeof value === 'object' ? value.toString() : String(value);
  const num = Number(raw);
  if (!Number.isFinite(num)) {
    return raw;
  }
  return Number.isInteger(num) ? String(num) : raw;
}
