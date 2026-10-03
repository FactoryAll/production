import { describe, it, expect } from 'vitest';
import { canViewTransfers, getNavItems } from '../nav-items';

describe('nav-items', () => {
  it('shows Перемещения for NP, KSGP, USGP and ADM (M07 §3)', () => {
    for (const role of ['NP', 'KSGP', 'USGP', 'ADM']) {
      expect(canViewTransfers([role])).toBe(true);
      expect(getNavItems([role]).map((item) => item.href)).toContain('/transfers');
    }
  });

  it('hides Перемещения from OPR (no transfer permissions)', () => {
    expect(canViewTransfers(['OPR'])).toBe(false);
    expect(getNavItems(['OPR']).map((item) => item.href)).not.toContain('/transfers');
  });

  it('shows Перемещения when any of the multiple roles grants access (Р-23)', () => {
    expect(canViewTransfers(['OPR', 'KSGP'])).toBe(true);
    expect(getNavItems(['OPR', 'KSGP']).map((item) => item.href)).toContain('/transfers');
  });

  it('keeps Перемещения between Остатки and Отчёты', () => {
    const hrefs = getNavItems(['NP']).map((item) => item.href);
    expect(hrefs).toEqual([
      '/dashboard',
      '/production-orders',
      '/shift-execution',
      '/stock',
      '/transfers',
      '/shift-reports',
    ]);
  });

  it('always keeps the base navigation entries', () => {
    const hrefs = getNavItems([]).map((item) => item.href);
    expect(hrefs).toContain('/dashboard');
    expect(hrefs).toContain('/production-orders');
    expect(hrefs).toContain('/shift-reports');
  });
});
