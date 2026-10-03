import { describe, it, expect } from 'vitest';
import { getLandingPath } from '../landing';

describe('getLandingPath', () => {
  it('sends a single-role OPR to shift execution', () => {
    expect(getLandingPath(['OPR'])).toBe('/shift-execution');
  });

  it('sends NP and ADM to production orders', () => {
    expect(getLandingPath(['NP'])).toBe('/production-orders');
    expect(getLandingPath(['ADM'])).toBe('/production-orders');
  });

  it('sends KSGP and USGP to transfers instead of a forbidden page', () => {
    // Regression: /dashboard used to redirect everyone to /production-orders,
    // which throws Forbidden for roles without production_order:read,
    // producing "Application error: a server-side exception has occurred".
    expect(getLandingPath(['KSGP'])).toBe('/transfers');
    expect(getLandingPath(['USGP'])).toBe('/transfers');
  });

  it('sends S1C to stock', () => {
    expect(getLandingPath(['S1C'])).toBe('/stock');
  });

  it('never returns a page the role cannot open', () => {
    const forbidding = ['KSGP', 'USGP', 'S1C'];
    for (const role of forbidding) {
      expect(getLandingPath([role])).not.toBe('/production-orders');
    }
  });

  it('handles multiple roles (Р-23): OPR + KSGP lands on transfers', () => {
    expect(getLandingPath(['OPR', 'KSGP'])).toBe('/transfers');
  });

  it('falls back to the password screen when no section is available', () => {
    expect(getLandingPath([])).toBe('/change-password');
    expect(getLandingPath(['UNKNOWN'])).toBe('/change-password');
  });
});
