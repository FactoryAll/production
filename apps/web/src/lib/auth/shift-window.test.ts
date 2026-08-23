import { describe, it, expect } from 'vitest';
import { getCurrentShiftWindow, isWithinShiftWindow } from './shift-window';

function dateAt(hour: number, minute: number, dayOffset = 0): Date {
  return new Date(2024, 0, 15 + dayOffset, hour, minute, 0, 0);
}

describe('getCurrentShiftWindow', () => {
  it('returns 1st shift window during morning hours', () => {
    const window = getCurrentShiftWindow(dateAt(10, 0));
    expect(window.shiftName).toBe('1-я смена');
    expect(window.start).toEqual(dateAt(8, 0));
    expect(window.end).toEqual(dateAt(20, 0));
    expect(window.windowStart).toEqual(dateAt(7, 0));
    expect(window.windowEnd).toEqual(dateAt(21, 0));
  });

  it('returns 2nd shift window before 08:00 (shift started yesterday)', () => {
    const window = getCurrentShiftWindow(dateAt(3, 0, 1));
    expect(window.shiftName).toBe('2-я смена');
    expect(window.start).toEqual(dateAt(20, 0, 0));
    expect(window.end).toEqual(dateAt(8, 0, 1));
    expect(window.windowStart).toEqual(dateAt(19, 0, 0));
    expect(window.windowEnd).toEqual(dateAt(9, 0, 1));
  });

  it('returns 2nd shift window after 20:00 (shift started today)', () => {
    const window = getCurrentShiftWindow(dateAt(21, 0));
    expect(window.shiftName).toBe('2-я смена');
    expect(window.start).toEqual(dateAt(20, 0));
    expect(window.end).toEqual(dateAt(8, 0, 1));
    expect(window.windowStart).toEqual(dateAt(19, 0));
    expect(window.windowEnd).toEqual(dateAt(9, 0, 1));
  });
});

describe('isWithinShiftWindow (BR-7)', () => {
  // Windows: 1st 07:00–21:00, 2nd 19:00–09:00 next day.
  // They overlap 19:00–21:00, so there is no time that is outside both windows.
  it('allows OPR access 30 minutes before 1st shift', () => {
    expect(isWithinShiftWindow(dateAt(7, 30))).toBe(true);
  });

  it('allows OPR at start of 1st shift', () => {
    expect(isWithinShiftWindow(dateAt(8, 0))).toBe(true);
  });

  it('allows OPR at end of 1st shift', () => {
    expect(isWithinShiftWindow(dateAt(20, 0))).toBe(true);
  });

  it('allows OPR 1 hour after 1st shift ends (inside 2nd shift window)', () => {
    expect(isWithinShiftWindow(dateAt(21, 0))).toBe(true);
  });

  it('allows OPR 1.5 hours after 1st shift ends (still inside 2nd shift window)', () => {
    expect(isWithinShiftWindow(dateAt(21, 30))).toBe(true);
  });

  it('allows OPR 1 hour before 2nd shift starts', () => {
    expect(isWithinShiftWindow(dateAt(19, 0))).toBe(true);
  });

  it('allows OPR at start of 2nd shift', () => {
    expect(isWithinShiftWindow(dateAt(20, 0))).toBe(true);
  });

  it('allows OPR at end of 2nd shift', () => {
    expect(isWithinShiftWindow(dateAt(8, 0, 1))).toBe(true);
  });

  it('allows OPR 1 hour after 2nd shift ends', () => {
    expect(isWithinShiftWindow(dateAt(9, 0, 1))).toBe(true);
  });

  it('allows OPR before 08:00 during 2nd shift window from previous day', () => {
    expect(isWithinShiftWindow(dateAt(6, 30, 1))).toBe(true);
  });

  it('confirms 09:01 next day is covered by the following 1st shift window', () => {
    // Because the 1st shift window of the next day starts at 07:00,
    // there is no gap after the 2nd shift window ends at 09:00.
    expect(isWithinShiftWindow(new Date(2024, 0, 16, 9, 1, 0, 0))).toBe(true);
  });

  it('confirms 06:59 today is covered by the previous 2nd shift window', () => {
    expect(isWithinShiftWindow(new Date(2024, 0, 15, 6, 59, 0, 0))).toBe(true);
  });
});