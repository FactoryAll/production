import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/page-guard', () => ({ checkPageAccess: vi.fn() }));
vi.mock('@/lib/reports/timesheet-report', () => ({ getTimesheetReport: vi.fn() }));
vi.mock('@prodtrack/db', () => ({
  prisma: {
    shift: { findMany: vi.fn() },
  },
}));

import { checkPageAccess } from '@/lib/auth/page-guard';
import { prisma } from '@prodtrack/db';
import { getTimesheetReport } from '@/lib/reports/timesheet-report';
import { AccessDenied } from '@/components/access-denied';
import TimesheetPage from '../page';

function mockAccess(allowed = true) {
  (checkPageAccess as ReturnType<typeof vi.fn>).mockResolvedValue({
    allowed,
    roles: ['OTK'],
    session: { userId: 'user-1', user: { id: 'user-1', roles: [{ role: { code: 'OTK' } }] } },
  });
}

const EMPTY_REPORT = {
  rows: [],
  employees: [],
  totals: { shifts: 0, hours: 0, discrepancies: 0 },
};

describe('Экран «Табель» (T-093): доступ и период', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.shift.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (getTimesheetReport as ReturnType<typeof vi.fn>).mockResolvedValue(EMPTY_REPORT);
  });

  it('без права reports:read показывает «Доступ запрещён», а не 500', async () => {
    mockAccess(false);

    const element = await TimesheetPage({ searchParams: {} });

    expect(element.type).toBe(AccessDenied);
    expect(getTimesheetReport).not.toHaveBeenCalled();
  });

  it('собирает отчёт за выбранный период и отдаёт его в таблицу', async () => {
    mockAccess(true);

    const element = await TimesheetPage({
      searchParams: { period: 'day', from: '2026-10-26', to: '2026-10-26' },
    });

    expect(element.type).toBe('main');
    expect(getTimesheetReport).toHaveBeenCalledTimes(1);
    const period = (getTimesheetReport as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(period.mode).toBe('day');
    // Период считается по местной дате: границы — те же сутки, что выбраны в форме.
    expect(period.label).toBe('26.10.2026');
  });

  it('берёт для формы последние смены', async () => {
    mockAccess(true);

    await TimesheetPage({ searchParams: {} });

    expect(prisma.shift.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 30, orderBy: { date: 'desc' } }),
    );
  });
});
