/**
 * Недели для фильтра отчётов (решение владельца 29.10.2026).
 *
 * Неделя **календарная**, с понедельника по воскресенье. Список недель строится из дат смен,
 * которые есть в базе, а не из «сегодня минус N»: иначе в фильтре появлялись бы недели,
 * по которым заведомо нет данных, и владелец выбирал бы пустоту.
 *
 * «Понедельник» считается по местному календарю: у `Date.getDay()` воскресенье — 0,
 * поэтому смещение берётся как `(day + 6) % 7`.
 */

const MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

/** Сколько недель показывать в списке: больше в одном отчёте не смотрят. */
export const WEEK_OPTIONS_LIMIT = 12;

/** Понедельник недели, в которую попадает дата, — начало суток по местному времени. */
export function mondayOf(date: Date): Date {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  const offset = (value.getDay() + 6) % 7;
  value.setDate(value.getDate() - offset);
  return value;
}

/** Границы недели: понедельник 00:00:00.000 — воскресенье 23:59:59.999 (местное время). */
export function weekBounds(date: Date): { from: Date; to: Date } {
  const from = mondayOf(date);
  const to = new Date(from);
  to.setDate(to.getDate() + 6);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

/** Дата в формате ГГГГ-ММ-ДД по местному календарю (как в адресе отчёта). */
export function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Подпись недели: «12–18 октября 2026». Если неделя переходит через месяц или год,
 * в подписи оба конца: «28 сентября – 4 октября 2026», «29 декабря 2025 – 4 января 2026».
 */
export function weekLabel(date: Date): string {
  const { from, to } = weekBounds(date);
  const sameMonth = from.getFullYear() === to.getFullYear() && from.getMonth() === to.getMonth();
  const sameYear = from.getFullYear() === to.getFullYear();

  if (sameMonth) {
    return `${from.getDate()}–${to.getDate()} ${MONTHS_GENITIVE[from.getMonth()]} ${from.getFullYear()}`;
  }
  if (sameYear) {
    return `${from.getDate()} ${MONTHS_GENITIVE[from.getMonth()]} – ${to.getDate()} ${MONTHS_GENITIVE[to.getMonth()]} ${from.getFullYear()}`;
  }
  return `${from.getDate()} ${MONTHS_GENITIVE[from.getMonth()]} ${from.getFullYear()} – ${to.getDate()} ${MONTHS_GENITIVE[to.getMonth()]} ${to.getFullYear()}`;
}

export interface WeekOption {
  /** Значение для адреса: понедельник недели, ГГГГ-ММ-ДД. */
  value: string;
  label: string;
  /** Границы для запроса — их форма отправляет как «с даты» и «по дату». */
  from: string;
  to: string;
}

/**
 * Список недель по датам смен: без пустых недель, свежие сверху, не больше `limit`.
 * Дубли убираются по понедельнику — у одной недели может быть сколько угодно смен.
 */
export function buildWeekOptions(
  dates: Date[],
  options: { limit?: number } = {},
): WeekOption[] {
  const limit = options.limit ?? WEEK_OPTIONS_LIMIT;
  const byMonday = new Map<string, WeekOption>();

  for (const date of dates) {
    const { from, to } = weekBounds(date);
    const value = isoDate(from);
    if (byMonday.has(value)) {
      continue;
    }
    byMonday.set(value, { value, from: value, to: isoDate(to), label: weekLabel(from) });
  }

  return [...byMonday.values()]
    .sort((a, b) => (a.value < b.value ? 1 : a.value > b.value ? -1 : 0))
    .slice(0, limit);
}
