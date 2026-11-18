/**
 * Документ корректировки остатков: подписи и границы (M05, решение владельца 18.11.2026).
 *
 * Модуль намеренно без импортов Prisma: его читают и экран, и серверные действия.
 * Постановка — `docs/stock_correction_design.md`.
 */
export const STOCK_ADJUSTMENT_REASON_OPTIONS: Array<{
  value: 'INVENTORY' | 'ACCOUNTING_ERROR' | 'DAMAGE' | 'RESORT' | 'OTHER';
  label: string;
}> = [
  { value: 'INVENTORY', label: 'Инвентаризация' },
  { value: 'ACCOUNTING_ERROR', label: 'Ошибка учёта' },
  { value: 'DAMAGE', label: 'Бой, порча' },
  { value: 'RESORT', label: 'Пересорт' },
  { value: 'OTHER', label: 'Прочее' },
];

export type StockAdjustmentReasonCode = (typeof STOCK_ADJUSTMENT_REASON_OPTIONS)[number]['value'];

export function stockAdjustmentReasonLabel(code: string): string {
  return STOCK_ADJUSTMENT_REASON_OPTIONS.find((option) => option.value === code)?.label ?? code;
}

export const STOCK_ADJUSTMENT_CATEGORY_LABELS: Record<'MASS' | 'PF' | 'GP', string> = {
  MASS: 'Масса',
  PF: 'ПФ',
  GP: 'ГП',
};

export const STOCK_ADJUSTMENT_DIRECTION_LABELS: Record<'RECEIPT' | 'ISSUE', string> = {
  RECEIPT: 'Приход',
  ISSUE: 'Списание',
};

/** Причина обязательна и не короче этого значения — «ок» вместо объяснения не принимается. */
export const STOCK_ADJUSTMENT_REASON_MIN_LENGTH = 10;

/**
 * Потолок на одну строку: защита от опечатки в ноликах. Остатки на проде — килограммы
 * и штуки; миллион в строке — это уже не корректировка, а опечатка.
 */
export const STOCK_ADJUSTMENT_MAX_QUANTITY = 1_000_000;

/** Номер документа: `КОР-2026-000123`. Сквозной, из последовательности базы. */
export function stockAdjustmentNumber(year: number, sequence: number | bigint): string {
  return `КОР-${year}-${String(sequence).padStart(6, '0')}`;
}
