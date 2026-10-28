/**
 * Длительность смены в часах (T-093, табель учёта рабочего времени).
 *
 * В справочнике смен время хранится строками «ЧЧ:ММ» (`Shift.start` – `Shift.end`),
 * а не датами. Поэтому смена «20:00–08:00» идёт через полночь и должна дать 12 часов,
 * а не минус двенадцать: к концу прибавляются сутки, если он не позже начала.
 *
 * Часы в табеле берутся **из справочника смен**, а не из отметок оператора: система
 * учитывает смены, а не фактически отработанные часы (решение владельца 26.10.2026,
 * `docs/timesheet_design.md` §2).
 */

const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

function parseMinutes(value: string): number | null {
  const match = TIME_PATTERN.exec(value.trim());
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

/**
 * Часы смены по времени начала и конца.
 *
 * Возвращает null, если хотя бы одно время не разобрано: в табеле это честнее,
 * чем подставить выдуманное число часов. Смена с одинаковым началом и концом
 * (00:00–00:00) считается сутками — 24 часа.
 */
export function shiftHours(start: string, end: string): number | null {
  const from = parseMinutes(start);
  const to = parseMinutes(end);
  if (from === null || to === null) {
    return null;
  }
  const minutes = to > from ? to - from : to - from + 24 * 60;
  return Math.round((minutes / 60) * 100) / 100;
}
