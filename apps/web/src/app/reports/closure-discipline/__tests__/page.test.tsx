import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/auth/page-guard', () => ({ checkPageAccess: vi.fn() }));
vi.mock('@/lib/reports/closure-discipline-report', () => ({
  getClosureDisciplineReport: vi.fn(),
  CLOSURE_OVERDUE_AFTER_DAYS: 2,
}));
vi.mock('@prodtrack/db', () => ({
  prisma: {
    shift: { findMany: vi.fn() },
    // Месяцы для фильтра: от месяца первого ПЗ до текущего.
    productionOrder: { findFirst: vi.fn().mockResolvedValue(null) },
  },
}));

import { checkPageAccess } from '@/lib/auth/page-guard';
import { prisma } from '@prodtrack/db';
import { getClosureDisciplineReport } from '@/lib/reports/closure-discipline-report';
import { AccessDenied } from '@/components/access-denied';
import ClosureDisciplinePage from '../page';

/**
 * Экран «Дисциплина закрытия ПЗ» (T-100, этап 3).
 *
 * Главное требование владельца к цвету: подсветка просроченной строки берётся из **флага
 * данных** (`overdue`), а не из сравнения дней в разметке. Поэтому в тесте есть строка
 * с `daysHanging: 5`, но `overdue: false` — такой набор возможен только если флаг и цвет
 * разъедутся, и экран обязан следовать флагу.
 */
function mockAccess(allowed = true) {
  (checkPageAccess as ReturnType<typeof vi.fn>).mockResolvedValue({
    allowed,
    roles: ['OTK'],
    session: { userId: 'user-1', user: { id: 'user-1', roles: [{ role: { code: 'OTK' } }] } },
  });
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    orderId: 'po-12345678',
    status: 'IN_PROGRESS',
    shiftNumber: 1,
    shiftDate: new Date('2026-10-12T00:00:00'),
    daysHanging: 8,
    overdue: true,
    linesTotal: 2,
    linesReported: 1,
    workCenters: [
      { code: '03', name: 'Тубировка крем', lineStatus: 'REPORTED', reported: true },
      { code: '05', name: 'Линия вязк.прод', lineStatus: 'ACCEPTED', reported: false },
    ],
    operators: 'Иванов И.И., Петров П.П.',
    updatedAt: new Date('2026-10-13T09:00:00'),
    ...overrides,
  };
}

const REPORT = {
  rows: [row()],
  totals: { unclosed: 1, overdue: 1, maxDays: 8 },
};

describe('Экран «Дисциплина закрытия ПЗ»', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.shift.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (getClosureDisciplineReport as ReturnType<typeof vi.fn>).mockResolvedValue(REPORT);
  });

  it('без права reports:read — экран «Доступ запрещён», а не 500', async () => {
    mockAccess(false);

    const element = await ClosureDisciplinePage({ searchParams: {} });

    expect(element.type).toBe(AccessDenied);
    expect(getClosureDisciplineReport).not.toHaveBeenCalled();
  });

  it('строка ПЗ: ссылка на документ, РЦ с отметками, строки, операторы, дни, просрочка', async () => {
    mockAccess();

    render((await ClosureDisciplinePage({ searchParams: {} })) as never);

    const link = screen.getByRole('link', { name: 'ПЗ po-12345' });
    expect(link.getAttribute('href')).toBe('/production-orders/po-12345678');

    expect(screen.getByText(/03 — отчитался/)).toBeTruthy();
    expect(screen.getByText(/05 — не отчитался/)).toBeTruthy();
    expect(screen.getByText('1 / 2')).toBeTruthy();
    expect(screen.getByText('Иванов И.И., Петров П.П.')).toBeTruthy();
    expect(screen.getByText('8')).toBeTruthy();
    expect(screen.getByText('да')).toBeTruthy();
  });

  it('подсветка строки идёт по флагу overdue, а не по числу дней', async () => {
    mockAccess();
    (getClosureDisciplineReport as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [
        // Пятнадцать дней, но флаг снят — цвет обязан следовать флагу, а не числу.
        row({ orderId: 'po-aaaaaaaa', daysHanging: 15, overdue: false }),
      ],
      totals: { unclosed: 1, overdue: 0, maxDays: 15 },
    });

    const { container } = render((await ClosureDisciplinePage({ searchParams: {} })) as never);

    const highlighted = container.querySelectorAll('tbody tr.bg-signal-amber\\/10');
    expect(highlighted).toHaveLength(0);
    expect(screen.getByText('15')).toBeTruthy();
    expect(screen.getByText('нет')).toBeTruthy();
  });

  it('просроченная строка подсвечена', async () => {
    mockAccess();

    const { container } = render((await ClosureDisciplinePage({ searchParams: {} })) as never);

    expect(container.querySelectorAll('tbody tr.bg-signal-amber\\/10')).toHaveLength(1);
  });

  it('итоги и ссылка выгрузки с периодом', async () => {
    mockAccess();

    render((await ClosureDisciplinePage({ searchParams: { period: 'day', from: '2026-10-12', to: '2026-10-18' } })) as never);

    expect(screen.getByText('незакрытых: 1')).toBeTruthy();
    expect(screen.getByText('просрочено: 1')).toBeTruthy();
    expect(screen.getByText('макс. срок: 8')).toBeTruthy();

    const exportLink = screen.getByRole('link', { name: 'Выгрузить в Excel' });
    const href = exportLink.getAttribute('href') ?? '';
    expect(href.startsWith('/reports/closure-discipline/export?')).toBe(true);
    // Период выгрузки — тот же, что на экране (ОПЭ-70 научил проверять это явно).
    expect(href).toContain('period=day');
    expect(href).toContain('from=2026-10-12');
    expect(href).toContain('to=2026-10-18');
  });

  it('висящих нет — понятный текст вместо пустой таблицы', async () => {
    mockAccess();
    (getClosureDisciplineReport as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [],
      totals: { unclosed: 0, overdue: 0, maxDays: 0 },
    });

    render((await ClosureDisciplinePage({ searchParams: {} })) as never);

    expect(screen.getByText('Незакрытых ПЗ за выбранный период нет.')).toBeTruthy();
  });
});
