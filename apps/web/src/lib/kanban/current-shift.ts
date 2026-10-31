/**
 * Текущая смена для фильтра доски по умолчанию (T-103, решение владельца 29.10.2026).
 *
 * Модуль чистый: получает смены и «сейчас», возвращает смену или null. Причина отдельного
 * модуля — переход через полночь. Смена «20:00–08:00» принадлежит вчерашней дате, и в 02:00
 * действующей будет именно она, а не «смена на сегодня», которой ещё нет. Наивное сравнение
 * «смена, у которой date = сегодня» в этот момент показало бы пустую доску.
 */

export interface ShiftWindow {
  id: string;
  number: number;
  /** Дата смены (начало суток по местному времени). */
  date: Date;
  /** Время начала и конца строками «ЧЧ:ММ», как в справочнике. */
  start: string;
  end: string;
}

const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

function minutesOf(value: string): number | null {
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

/** Начало и конец окна смены в реальном времени; null — время в справочнике не разобрано. */
export function shiftWindowBounds(shift: ShiftWindow): { from: Date; to: Date } | null {
  const startMinutes = minutesOf(shift.start);
  const endMinutes = minutesOf(shift.end);
  if (startMinutes === null || endMinutes === null) {
    return null;
  }

  const from = new Date(shift.date);
  from.setHours(0, 0, 0, 0);
  from.setMinutes(startMinutes);

  const to = new Date(shift.date);
  to.setHours(0, 0, 0, 0);
  to.setMinutes(endMinutes);
  // Конец не позже начала — смена переходит через полночь: конец на следующие сутки.
  if (endMinutes <= startMinutes) {
    to.setDate(to.getDate() + 1);
  }

  return { from, to };
}

function shiftStartAt(shift: ShiftWindow): Date {
  const bounds = shiftWindowBounds(shift);
  if (bounds) {
    return bounds.from;
  }
  const date = new Date(shift.date);
  date.setHours(0, 0, 0, 0);
  return date;
}

/**
 * Смена, за которую доска открывается по умолчанию (решение владельца: текущая смена).
 *
 * Правило — **смена, начавшаяся позже всех, но не позже «сейчас»**. Для обычного расписания
 * (днём 08:00–20:00, ночью 20:00–08:00) это ровно «идущая смена»: в 02:00 начавшейся позже всех
 * будет вчерашняя ночная, а не завтрашняя дневная. Отдельная проверка «входит ли сейчас в окно
 * смены» ничего не добавляет к этому правилу и только создавала вид, что она что-то решает,
 * поэтому её нет: `shiftWindowBounds` остаётся экспортированным — по нему интерфейс подписывает
 * смену как идущую.
 */
export function resolveCurrentShift(shifts: ShiftWindow[], now: Date = new Date()): ShiftWindow | null {
  const started = shifts
    .map((shift) => ({ shift, start: shiftStartAt(shift) }))
    .filter((item) => item.start <= now)
    .sort((a, b) => b.start.getTime() - a.start.getTime());

  return started.length > 0 ? started[0].shift : null;
}
