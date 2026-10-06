/**
 * Период дашборда M11 (Р-08) и правило «текущей смены».
 *
 * M11 §8 требует виджеты «объёмы произведённого по категориям» и «принято на склад ГП
 * за период», но сам период не задаёт. Решение владельца продукта 06.10.2026 (вариант A):
 * период выбирается на экране, по умолчанию — текущая смена.
 *
 * Смена определяется по Р-05: 1-я 08:00–20:00, 2-я 20:00–08:00 следующего дня.
 *
 * ВАЖНО про модель данных: справочник `Shift` — это две шаблонные строки (M01 §4.1,
 * `SHIFT_SEED_DATE` в сиде), а не экземпляры смен по датам. Поэтому «ПЗ текущей смены»
 * (M11 BR-5) — это ПЗ, привязанные к шаблонной смене с номером текущего времени суток.
 */

import { getCurrentShiftWindow } from '@/lib/auth/shift-window';

export type DashboardPeriod = 'SHIFT' | 'TODAY' | 'WEEK' | 'MONTH';

export const DASHBOARD_PERIODS: readonly DashboardPeriod[] = ['SHIFT', 'TODAY', 'WEEK', 'MONTH'];

export const DEFAULT_DASHBOARD_PERIOD: DashboardPeriod = 'SHIFT';

export const DASHBOARD_PERIOD_LABELS: Record<DashboardPeriod, string> = {
  SHIFT: 'Текущая смена',
  TODAY: 'Сегодня',
  WEEK: '7 дней',
  MONTH: '30 дней',
};

export interface DateRange {
  from: Date;
  to: Date;
}

export function parseDashboardPeriod(value: string | undefined | null): DashboardPeriod {
  return DASHBOARD_PERIODS.includes(value as DashboardPeriod)
    ? (value as DashboardPeriod)
    : DEFAULT_DASHBOARD_PERIOD;
}

function startOfDay(value: Date): Date {
  const result = new Date(value);
  result.setHours(0, 0, 0, 0);
  return result;
}

/** Границы периода `[from; to)`. */
export function dashboardPeriodRange(period: DashboardPeriod, now: Date): DateRange {
  const today = startOfDay(now);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  switch (period) {
    case 'TODAY':
      return { from: today, to: tomorrow };
    case 'WEEK': {
      const from = new Date(today);
      from.setDate(from.getDate() - 6);
      return { from, to: tomorrow };
    }
    case 'MONTH': {
      const from = new Date(today);
      from.setDate(from.getDate() - 29);
      return { from, to: tomorrow };
    }
    case 'SHIFT':
    default: {
      const window = getCurrentShiftWindow(now);
      return { from: window.start, to: window.end };
    }
  }
}

// Номер текущей смены живёт в @prodtrack/db (вместе с остальными правилами смен, T-075):
// этот модуль остаётся чистым, потому что его импортирует клиентский компонент экрана.
