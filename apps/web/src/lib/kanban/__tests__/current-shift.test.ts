import { describe, it, expect } from 'vitest';
import { resolveCurrentShift, shiftWindowBounds, type ShiftWindow } from '../current-shift';

/**
 * Текущая смена для доски (T-103, решение владельца 29.10.2026).
 *
 * Главный крайний случай — переход через полночь: смена «20:00–08:00» принадлежит вчерашней
 * дате, и в 02:00 действует именно она. Наивное «date = сегодня» показало бы пустую доску.
 */
function shift(overrides: Partial<ShiftWindow> = {}): ShiftWindow {
  return {
    id: 'shift-1',
    number: 1,
    date: new Date('2026-10-30T00:00:00'),
    start: '08:00',
    end: '20:00',
    ...overrides,
  };
}

describe('окно смены', () => {
  it('дневная смена — те же сутки', () => {
    const bounds = shiftWindowBounds(shift())!;
    expect(bounds.from.getHours()).toBe(8);
    expect(bounds.to.getHours()).toBe(20);
    expect(bounds.from.getDate()).toBe(bounds.to.getDate());
  });

  it('ночная смена — конец на следующих сутках', () => {
    const bounds = shiftWindowBounds(shift({ start: '20:00', end: '08:00' }))!;
    expect(bounds.from.getDate()).toBe(30);
    expect(bounds.to.getDate()).toBe(31);
    expect(bounds.to.getHours()).toBe(8);
  });

  it('смена сутки (00:00–00:00) — окно на сутки', () => {
    const bounds = shiftWindowBounds(shift({ start: '00:00', end: '00:00' }))!;
    expect(bounds.to.getTime() - bounds.from.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('неразобранное время — окна нет', () => {
    expect(shiftWindowBounds(shift({ start: 'скоро' }))).toBeNull();
  });
});

describe('текущая смена', () => {
  it('берёт смену, в окне которой сейчас время', () => {
    const day = shift();
    const night = shift({ id: 'shift-2', number: 2, start: '20:00', end: '08:00' });

    expect(resolveCurrentShift([day, night], new Date('2026-10-30T10:00:00'))?.id).toBe('shift-1');
    expect(resolveCurrentShift([day, night], new Date('2026-10-30T22:00:00'))?.id).toBe('shift-2');
  });

  it('ночная смена действует после полуночи', () => {
    const night = shift({ id: 'shift-2', number: 2, start: '20:00', end: '08:00' });

    // 02:00 следующих суток: смена помечена 30-м числом, но идёт ещё она.
    expect(resolveCurrentShift([night], new Date('2026-10-31T02:00:00'))?.id).toBe('shift-2');
  });

  it('между сменами — ближайшая прошедшая, а не следующая', () => {
    const day = shift();
    const night = shift({ id: 'shift-2', number: 2, start: '20:00', end: '08:00' });

    // 19:00 — в окне дневной смены; проверим «между» после её конца: 08:10 при графике,
    // где ночная начинается в 20:00, — это ещё дневная, поэтому берём окно 09:00–11:00.
    const short = shift({ id: 'shift-short', start: '09:00', end: '11:00' });
    expect(resolveCurrentShift([short, night], new Date('2026-10-30T15:00:00'))?.id).toBe(
      'shift-short',
    );
    expect(resolveCurrentShift([day, night], new Date('2026-10-30T12:00:00'))?.id).toBe('shift-1');
  });

  it('смен нет — null', () => {
    expect(resolveCurrentShift([], new Date('2026-10-30T12:00:00'))).toBeNull();
  });

  it('все смены в будущем — null', () => {
    const future = shift({ date: new Date('2026-11-05T00:00:00') });
    expect(resolveCurrentShift([future], new Date('2026-10-30T12:00:00'))).toBeNull();
  });

  it('из двух одновременно идущих берётся та, что началась позже', () => {
    const first = shift({ id: 'shift-1', start: '08:00', end: '20:00' });
    const second = shift({ id: 'shift-2', number: 2, start: '12:00', end: '23:00' });

    expect(resolveCurrentShift([first, second], new Date('2026-10-30T13:00:00'))?.id).toBe('shift-2');
  });
});
