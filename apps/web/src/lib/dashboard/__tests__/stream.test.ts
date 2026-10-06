import { describe, it, expect } from 'vitest';
import {
  buildDashboardRevision,
  dashboardStreamFrame,
  dashboardStreamPing,
  isDashboardStreamChanged,
} from '../stream';

describe('Канал дашборда: отпечаток состояния (M11 BR-2)', () => {
  it('меняется при появлении новой записи', () => {
    const before = buildDashboardRevision([{ count: 3, lastAt: new Date('2026-10-06T08:00:00Z') }]);
    const after = buildDashboardRevision([{ count: 4, lastAt: new Date('2026-10-06T08:05:00Z') }]);

    expect(after).not.toBe(before);
  });

  it('меняется при правке существующей записи без роста количества', () => {
    const before = buildDashboardRevision([{ count: 3, lastAt: new Date('2026-10-06T08:00:00Z') }]);
    const after = buildDashboardRevision([{ count: 3, lastAt: new Date('2026-10-06T08:01:00Z') }]);

    expect(after).not.toBe(before);
  });

  it('устойчив к пустым таблицам', () => {
    expect(buildDashboardRevision([{ count: 0, lastAt: null }])).toBe('0@-');
  });
});

describe('Канал дашборда: кадры', () => {
  it('кадр данных — строка data с JSON и пустой строкой', () => {
    expect(dashboardStreamFrame({ revision: 'r-1' })).toBe('data: {"revision":"r-1"}\n\n');
  });

  it('кадр keep-alive — комментарий SSE', () => {
    expect(dashboardStreamPing()).toBe(': ping\n\n');
  });

  it('шлём только изменения', () => {
    expect(isDashboardStreamChanged({ revision: 'r-1' }, { revision: 'r-1' })).toBe(false);
    expect(isDashboardStreamChanged({ revision: 'r-1' }, { revision: 'r-2' })).toBe(true);
  });
});
