import { describe, it, expect } from 'vitest';
import { timingScope } from '../scope';

describe('timingScope (M10 §3)', () => {
  it('ограничивает ОПР своим РЦ', () => {
    expect(timingScope(['OPR'])).toBe('OWN_WORK_CENTER');
  });

  it('не ограничивает остальные роли', () => {
    for (const role of ['NP', 'KSGP', 'USGP', 'S1C', 'ADM']) {
      expect(timingScope([role])).toBe('ALL');
    }
  });

  it('снимает ограничение при совмещении ролей (Р-23)', () => {
    expect(timingScope(['OPR', 'KSGP'])).toBe('ALL');
  });

  it('не ограничивает, если роли неизвестны', () => {
    expect(timingScope([])).toBe('ALL');
  });
});
