'use client';

import { useState } from 'react';
import { currentMonth, monthLabel } from '@/lib/reports/period';
import { mondayOf, isoDate, type WeekOption } from '@/lib/reports/weeks';

/**
 * Выбор периода отчёта (решение владельца 26.10.2026, переделка фильтров 29.10.2026).
 *
 * Показываются только поля выбранного режима: «Месяцы» — месяцы, «День» — две даты,
 * «Неделя» — список календарных недель, «Смена» — список смен. Раньше все контролы
 * висели одновременно, и было непонятно, что из них относится к делу (замечание владельца).
 *
 * Переключение режима — клиентское состояние, без перезагрузки и без отправки формы:
 * поля меняются сразу, а отчёт применяется кнопкой «Показать». Форма отправляется методом GET,
 * поэтому фильтры остаются в адресе, ссылку можно переслать, и выгрузка строится по тем же
 * параметрам.
 */
export function PeriodForm({
  action,
  period,
  months,
  from,
  to,
  weeks,
  shifts,
  category,
}: {
  action: string;
  /** Режим, с которым отчёт открыт сейчас. */
  period: string;
  months: string[];
  from: string;
  to: string;
  /** Календарные недели, в которые есть смены (свежие сверху). */
  weeks: WeekOption[];
  /** Последние смены для режима «смена». */
  shifts: Array<{ id: string; label: string; date: string }>;
  /** Если задано — показываем выбор категории выпуска (отчёт по номенклатуре). */
  category?: string;
}) {
  const [mode, setMode] = useState(period);
  // Выбранная неделя: понедельник в формате ГГГГ-ММ-ДД. По умолчанию — неделя, в которой
  // начинается показанный период, чтобы форма открывалась на том же, что и таблица.
  const [week, setWeek] = useState(() => {
    const monday = isoDate(mondayOf(new Date(`${from}T00:00:00`)));
    return weeks.some((option) => option.value === monday) ? monday : (weeks[0]?.value ?? '');
  });
  const [shiftId, setShiftId] = useState(shifts[0]?.id ?? '');

  // Последние 14 месяцев: больше в одном отчёте всё равно не просматривают.
  const today = new Date();
  const monthOptions = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth() - index, 1);
    const value = currentMonth(date);
    return { value, label: monthLabel(value) };
  });

  const selectedWeek = weeks.find((option) => option.value === week);
  const selectedShift = shifts.find((shift) => shift.id === shiftId);

  return (
    <form method="get" action={action} className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-steel-graphite">Период</span>
        <select
          name="period"
          value={mode}
          onChange={(event) => setMode(event.target.value)}
          className="h-10 rounded-md border border-mist-metal bg-white px-3 text-base text-graphite"
        >
          <option value="months">Месяцы</option>
          <option value="day">День</option>
          <option value="week">Неделя</option>
          <option value="shift">Смена</option>
        </select>
      </label>

      {mode === 'months' && (
        <details className="text-sm" open>
          <summary className="cursor-pointer rounded-md border border-mist-metal bg-white px-3 py-2 text-graphite">
            Месяцы{months.length > 0 ? `: ${months.map(monthLabel).join(', ')}` : ''}
          </summary>
          <div className="mt-2 grid max-h-56 grid-cols-2 gap-1 overflow-y-auto rounded-md border border-mist-metal bg-white p-3">
            {monthOptions.map((option) => (
              <label key={option.value} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="months"
                  value={option.value}
                  defaultChecked={months.includes(option.value)}
                />
                {option.label}
              </label>
            ))}
          </div>
        </details>
      )}

      {mode === 'day' && (
        <>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-steel-graphite">С даты</span>
            <input
              type="date"
              name="from"
              defaultValue={from}
              className="h-10 rounded-md border border-mist-metal bg-white px-3 text-base text-graphite"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-steel-graphite">По дату</span>
            <input
              type="date"
              name="to"
              defaultValue={to}
              className="h-10 rounded-md border border-mist-metal bg-white px-3 text-base text-graphite"
            />
          </label>
        </>
      )}

      {mode === 'week' && (
        <>
          {weeks.length === 0 ? (
            <p className="text-sm text-steel-graphite">
              Смен в базе нет — недель для выбора тоже нет.
            </p>
          ) : (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-steel-graphite">Неделя</span>
              <select
                name="week"
                value={week}
                onChange={(event) => setWeek(event.target.value)}
                className="h-10 max-w-[20rem] rounded-md border border-mist-metal bg-white px-3 text-base text-graphite"
              >
                {weeks.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {/* Границы недели уходят в адрес так же, как их ждёт серверный разбор периода. */}
          {selectedWeek && (
            <>
              <input type="hidden" name="from" value={selectedWeek.from} />
              <input type="hidden" name="to" value={selectedWeek.to} />
            </>
          )}
        </>
      )}

      {mode === 'shift' && (
        <>
          {shifts.length === 0 ? (
            <p className="text-sm text-steel-graphite">Смен в базе нет.</p>
          ) : (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-steel-graphite">Смена</span>
              <select
                name="shiftId"
                value={shiftId}
                onChange={(event) => setShiftId(event.target.value)}
                className="h-10 max-w-[20rem] rounded-md border border-mist-metal bg-white px-3 text-base text-graphite"
              >
                {shifts.map((shift) => (
                  <option key={shift.id} value={shift.id}>
                    {shift.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {/* Дата выбранной смены: без неё серверный разбор брал бы «сегодня». */}
          {selectedShift && (
            <>
              <input type="hidden" name="shiftDate" value={selectedShift.date} />
              <input type="hidden" name="shiftLabel" value={selectedShift.label} />
            </>
          )}
        </>
      )}

      {category !== undefined && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-steel-graphite">Категория</span>
          <select
            name="category"
            defaultValue={category}
            className="h-10 rounded-md border border-mist-metal bg-white px-3 text-base text-graphite"
          >
            <option value="">Все</option>
            <option value="MASS">Масса</option>
            <option value="GP">ГП</option>
            <option value="PF">ПФ</option>
          </select>
        </label>
      )}

      <button
        type="submit"
        className="h-10 rounded-md border border-transparent bg-deep-industry-blue px-5 text-base font-medium text-white hover:bg-[#0f264f]"
      >
        Показать
      </button>
    </form>
  );
}
