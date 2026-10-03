import { describe, it, expect } from 'vitest';
import { canViewTransfers, getNavItems } from '../nav-items';

const hrefsFor = (roles: string[]) => getNavItems(roles).map((item) => item.href);

describe('nav-items', () => {
  it('shows Перемещения for NP, KSGP, USGP and ADM (M07 §3)', () => {
    for (const role of ['NP', 'KSGP', 'USGP', 'ADM']) {
      expect(canViewTransfers([role])).toBe(true);
      expect(hrefsFor([role])).toContain('/transfers');
    }
  });

  it('hides Перемещения from OPR and S1C (no transfer permissions)', () => {
    for (const role of ['OPR', 'S1C']) {
      expect(canViewTransfers([role])).toBe(false);
      expect(hrefsFor([role])).not.toContain('/transfers');
    }
  });

  it('shows Перемещения when any of the multiple roles grants access (Р-23)', () => {
    expect(canViewTransfers(['OPR', 'KSGP'])).toBe(true);
    expect(hrefsFor(['OPR', 'KSGP'])).toContain('/transfers');
  });

  it('builds the NP menu in a stable order', () => {
    expect(hrefsFor(['NP'])).toEqual([
      '/dashboard',
      '/notifications',
      '/production-orders',
      '/stock',
      '/transfers',
      '/audit',
      '/timing',
    ]);
  });

  it('builds the KSGP menu without pages the role cannot open', () => {
    expect(hrefsFor(['KSGP'])).toEqual([
      '/dashboard',
      '/notifications',
      '/stock',
      '/transfers',
      '/timing',
    ]);
  });

  it('builds the OPR menu without Перемещения and without ПЗ', () => {
    expect(hrefsFor(['OPR'])).toEqual([
      '/dashboard',
      '/notifications',
      '/shift-execution',
      '/stock',
      '/timing',
    ]);
  });

  it('builds the full menu for ADM', () => {
    expect(hrefsFor(['ADM'])).toEqual([
      '/dashboard',
      '/notifications',
      '/production-orders',
      '/shift-execution',
      '/stock',
      '/transfers',
      '/audit',
      '/timing',
    ]);
  });

  it('hides the production orders page from roles lacking production_order:read', () => {
    for (const role of ['KSGP', 'USGP', 'S1C']) {
      expect(hrefsFor([role])).not.toContain('/production-orders');
    }
  });

  it('никогда не выводит ссылку на несуществующую страницу /shift-reports', () => {
    for (const role of ['NP', 'OPR', 'KSGP', 'USGP', 'S1C', 'ADM']) {
      expect(hrefsFor([role])).not.toContain('/shift-reports');
    }
  });

  it('shows Уведомления for every role (M09 §3: просмотр своих уведомлений — R для всех)', () => {
    for (const role of ['NP', 'OPR', 'KSGP', 'USGP', 'S1C', 'ADM']) {
      expect(hrefsFor([role])).toContain('/notifications');
    }
  });

  it('shows Хронометраж for every role (M10 §3: просмотр хронометража — R для всех)', () => {
    for (const role of ['NP', 'OPR', 'KSGP', 'USGP', 'S1C', 'ADM']) {
      expect(hrefsFor([role])).toContain('/timing');
    }
  });

  it('shows Аудит only for НП и АДМ (M13 §3, BR-3)', () => {
    expect(hrefsFor(['NP'])).toContain('/audit');
    expect(hrefsFor(['ADM'])).toContain('/audit');
    for (const role of ['OPR', 'KSGP', 'USGP', 'S1C']) {
      expect(hrefsFor([role])).not.toContain('/audit');
    }
  });

  it('always keeps the dashboard entry', () => {
    for (const role of ['NP', 'OPR', 'KSGP', 'USGP', 'S1C', 'ADM']) {
      expect(hrefsFor([role])).toContain('/dashboard');
    }
  });
});
