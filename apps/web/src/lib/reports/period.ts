/**
 * Период отчёта (решение владельца 26.10.2026): смена, день, неделя, месяц.
 *
 * Месяцы выбираются **несколькими** и могут быть непоследовательными (сентябрь и ноябрь),
 * поэтому для режима «месяц» хранится список, а не диапазон. Для остальных режимов —
 * диапазон дат.
 */
export type ReportPeriodMode = 'shift' | 'day' | 'week' | 'months';

export interface ReportPeriod {
  mode: ReportPeriodMode;
  /** Границы включительно. */
  from: Date;
  to: Date;
  /** Выбранные месяцы в формате ГГГГ-ММ (только для режима months). */
  months: string[];
  /** Смена (только для режима shift). */
  shiftId?: string;
  /** Как подписать период в заголовке отчёта и в имени файла. */
  label: string;
}

const MONTH_NAMES = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

export function startOfDay(date: Date): Date {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

export function endOfDay(date: Date): Date {
  const value = new Date(date);
  value.setHours(23, 59, 59, 999);
  return value;
}

/** Первый и последний день месяца по строке ГГГГ-ММ. */
export function monthBounds(month: string): { from: Date; to: Date } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) {
    return null;
  }
  return {
    from: new Date(year, monthIndex, 1, 0, 0, 0, 0),
    to: new Date(year, monthIndex + 1, 0, 23, 59, 59, 999),
  };
}

export function monthLabel(month: string): string {
  const bounds = monthBounds(month);
  if (!bounds) {
    return month;
  }
  return `${MONTH_NAMES[bounds.from.getMonth()]} ${bounds.from.getFullYear()}`;
}

/** Текущий месяц в формате ГГГГ-ММ. */
export function currentMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function parseDate(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Собирает период из параметров строки запроса. По умолчанию — текущий месяц,
 * чтобы отчёт всегда открывался с данными, а не пустой.
 */
export function parseReportPeriod(params: {
  period?: string;
  from?: string;
  to?: string;
  months?: string;
  shiftId?: string;
  shiftLabel?: string;
  shiftDate?: string;
  now?: Date;
}): ReportPeriod {
  const now = params.now ?? new Date();
  const mode = (params.period ?? 'months') as ReportPeriodMode;

  if (mode === 'months') {
    const listed = (params.months ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter((item) => monthBounds(item) !== null)
      .sort();
    const chosen = listed.length > 0 ? listed : [currentMonth(now)];
    const first = monthBounds(chosen[0])!;
    const last = monthBounds(chosen[chosen.length - 1])!;
    return {
      mode: 'months',
      months: chosen,
      from: first.from,
      to: last.to,
      label: chosen.map(monthLabel).join(', '),
    };
  }

  if (mode === 'shift') {
    const shiftDate = parseDate(params.shiftDate) ?? startOfDay(now);
    return {
      mode: 'shift',
      shiftId: params.shiftId,
      from: startOfDay(shiftDate),
      to: endOfDay(shiftDate),
      months: [],
      label: params.shiftLabel ?? shiftDate.toLocaleDateString('ru-RU'),
    };
  }

  const from = parseDate(params.from) ?? startOfDay(now);
  const to = parseDate(params.to) ?? from;
  const [rangeFrom, rangeTo] = from <= to ? [from, to] : [to, from];

  if (mode === 'day') {
    return {
      mode: 'day',
      from: startOfDay(rangeFrom),
      to: endOfDay(rangeFrom),
      months: [],
      label: rangeFrom.toLocaleDateString('ru-RU'),
    };
  }

  if (mode === 'week') {
    const weekEnd = new Date(rangeFrom);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const last = rangeTo > rangeFrom ? rangeTo : weekEnd;
    return {
      mode: 'week',
      from: startOfDay(rangeFrom),
      to: endOfDay(last),
      months: [],
      label: `${rangeFrom.toLocaleDateString('ru-RU')} — ${last.toLocaleDateString('ru-RU')}`,
    };
  }

  return {
    mode: 'months',
    months: [],
    from: startOfDay(rangeFrom),
    to: endOfDay(rangeTo),
    label: `${rangeFrom.toLocaleDateString('ru-RU')} — ${rangeTo.toLocaleDateString('ru-RU')}`,
  };
}

/** Имя файла выгрузки: отчёт + период. */
export function reportFileName(report: string, period: ReportPeriod): string {
  const stamp = `${period.from.toISOString().slice(0, 10)}_${period.to.toISOString().slice(0, 10)}`;
  return `${report}_${stamp}.csv`;
}

/**
 * Дата для поля ввода и для имени файла — по **местному** календарю.
 *
 * `toISOString()` переводит местную полночь в UTC и в Москве даёт предыдущий день
 * (местное 20.10 00:00 = 19.10 21:00Z). Поэтому дату собираем из местных частей.
 */
export function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
