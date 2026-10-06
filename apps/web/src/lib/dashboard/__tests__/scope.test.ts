import { describe, it, expect } from 'vitest';
import { dashboardScope } from '../scope';

describe('Область видимости дашборда (M11 §3, BR-3)', () => {
  it('сводно — для ролей с правом dashboard:read', () => {
    for (const role of ['NP', 'KSGP', 'USGP', 'S1C', 'ADM']) {
      expect(dashboardScope([role])).toBe('ALL');
    }
  });

  it('в разрезе своего РЦ — для Оператора (dashboard:read_own)', () => {
    expect(dashboardScope(['OPR'])).toBe('OWN_WORK_CENTER');
  });

  it('совмещение ролей расширяет видимость (Р-23)', () => {
    expect(dashboardScope(['OPR', 'KSGP'])).toBe('ALL');
  });

  it('без известных ролей видимость ограничивается', () => {
    expect(dashboardScope([])).toBe('OWN_WORK_CENTER');
    expect(dashboardScope(['UNKNOWN'])).toBe('OWN_WORK_CENTER');
  });
});
