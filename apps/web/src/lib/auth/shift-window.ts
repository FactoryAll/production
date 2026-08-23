/**
 * Shift window as defined by BR-7 (Р-07).
 * Window = [shift start − 1 h; shift end + 1 h].
 * 1st shift 08:00–20:00 → window 07:00–21:00.
 * 2nd shift 20:00–08:00 next day → window 19:00–09:00 next day.
 * The two windows overlap between 19:00 and 21:00 (change-over hour).
 */
export interface ShiftWindow {
  shiftName: string;
  start: Date;
  end: Date;
  windowStart: Date;
  windowEnd: Date;
}

export function getCurrentShiftWindow(now: Date): ShiftWindow {
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const currentTime = hours * 60 + minutes;

  const shift1Start = 8 * 60; // 08:00
  const shift1End = 20 * 60; // 20:00

  if (currentTime >= shift1Start && currentTime < shift1End) {
    const shiftStart = new Date(now);
    shiftStart.setHours(8, 0, 0, 0);

    const shiftEnd = new Date(now);
    shiftEnd.setHours(20, 0, 0, 0);

    const windowStart = new Date(shiftStart);
    windowStart.setHours(7, 0, 0, 0);

    const windowEnd = new Date(shiftEnd);
    windowEnd.setHours(21, 0, 0, 0);

    return {
      shiftName: '1-я смена',
      start: shiftStart,
      end: shiftEnd,
      windowStart,
      windowEnd,
    };
  }

  // 2-я смена: 20:00–08:00 следующего дня
  const shiftStart = new Date(now);
  if (currentTime >= shift1End) {
    // После 20:00 — смена началась сегодня
    shiftStart.setHours(20, 0, 0, 0);
  } else {
    // До 08:00 — смена началась вчера
    shiftStart.setDate(shiftStart.getDate() - 1);
    shiftStart.setHours(20, 0, 0, 0);
  }

  const shiftEnd = new Date(shiftStart);
  shiftEnd.setDate(shiftEnd.getDate() + 1);
  shiftEnd.setHours(8, 0, 0, 0);

  const windowStart = new Date(shiftStart);
  windowStart.setHours(19, 0, 0, 0);

  const windowEnd = new Date(shiftEnd);
  windowEnd.setHours(9, 0, 0, 0);

  return {
    shiftName: '2-я смена',
    start: shiftStart,
    end: shiftEnd,
    windowStart,
    windowEnd,
  };
}

export function isWithinShiftWindow(now: Date): boolean {
  const window = getCurrentShiftWindow(now);
  return now >= window.windowStart && now < window.windowEnd;
}