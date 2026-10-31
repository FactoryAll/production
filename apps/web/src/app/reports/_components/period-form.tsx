'use client';

import { useState } from 'react';
import { currentMonth, monthLabel } from '@/lib/reports/period';
import { defaultMonthYear, monthsOfYear, yearsOf } from '@/lib/reports/months';
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
  monthsAvailable,
  from,
  to,
  weeks,
  shifts,
  category,
  workCenters,
  workCenter,
}: {
  action: string;
  /** Режим, с которым отчёт открыт сейчас. */
  period: string;
  /** Выбранные месяцы (для режима «Месяцы»). */
  months: string[];
  /** Месяцы, которые есть в данных: от первого ПЗ до текущего, свежие сверху. */
  monthsAvailable: string[];
  from: string;
  to: string;
  /** Календарные недели, в которые есть смены (свежие сверху). */
  weeks: WeekOption[];
  /** Последние смены для режима «смена». */
  shifts: Array<{ id: string; label: string; date: string }>;
  /** Если задано — показываем выбор категории выпуска (отчёт по номенклатуре). */
  category?: string;
  /** Если задано — показываем фильтр по РЦ (отчёт «Выработка по сотрудникам», T-097). */
  workCenters?: Array<{ id: string; label: string }>;
  workCenter?: string;
}) {
  const [mode, setMode] = useState(period);
  // Выбранная неделя: понедельник в формате ГГГГ-ММ-ДД. По умолчанию — неделя, в которой
  // начинается показанный период, чтобы форма открывалась на том же, что и таблица.
  const [week, setWeek] = useState(() => {
    const monday = isoDate(mondayOf(new Date(`${from}T00:00:00`)));
    return weeks.some((option) => option.value === monday) ? monday : (weeks[0]?.value ?? '');
  });
  const [shiftId, setShiftId] = useState(shifts[0]?.id ?? '');
  // Выбор месяцев живёт в состоянии, а не в `defaultChecked`: при переключении года
  // чекбоксы другого года исчезают с экрана, но выбранные месяцы теряться не должны
  // (требование владельца 29.10.2026 — можно набрать месяцы разных лет).
  const [selectedMonths, setSelectedMonths] = useState<string[]>(() =>
    months.length > 0 ? months : [currentMonth()],
  );
  const [year, setYear] = useState(() => defaultMonthYear(monthsAvailable));

  const years = yearsOf(monthsAvailable);
  const visibleMonths = monthsOfYear(monthsAvailable, year);
  const monthsOutsideYear = selectedMonths.filter(
    (month) => Number(month.slice(0, 4)) !== year,
  );

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
        <div className="text-sm">
          {/*
            Год переключает только видимые месяцы. Выбранные месяцы уходят в адрес скрытыми
            полями, поэтому набор может содержать месяцы разных лет.
          */}
          <div className="flex items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-steel-graphite">Год</span>
              <select
                aria-label="Год"
                value={year}
                onChange={(event) => setYear(Number(event.target.value))}
                className="h-10 rounded-md border border-mist-metal bg-white px-3 text-base text-graphite"
              >
                {years.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid max-h-56 grid-cols-2 gap-1 overflow-y-auto rounded-md border border-mist-metal bg-white p-3">
              {visibleMonths.length === 0 ? (
                <p className="col-span-2 text-steel-graphite">За этот год месяцев нет.</p>
              ) : (
                visibleMonths.map((month) => (
                  <label key={month} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedMonths.includes(month)}
                      onChange={(event) =>
                        setSelectedMonths((current) =>
                          event.target.checked
                            ? [...current, month].sort()
                            : current.filter((item) => item !== month),
                        )
                      }
                    />
                    {monthLabel(month)}
                  </label>
                ))
              )}
            </div>
          </div>

          {/* Выбранные месяцы — в адрес; чекбоксы служат только для выбора. */}
          {selectedMonths.map((month) => (
            <input key={month} type="hidden" name="months" value={month} />
          ))}

          <p className="mt-1 text-steel-graphite">
            Выбрано: {selectedMonths.length > 0 ? selectedMonths.map(monthLabel).join(', ') : 'ни одного месяца'}
            {monthsOutsideYear.length > 0
              ? ` (из них не в этом году: ${monthsOutsideYear.map(monthLabel).join(', ')})`
              : ''}
          </p>
        </div>
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

      {workCenters !== undefined && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-steel-graphite">РЦ</span>
          <select
            name="workCenterId"
            defaultValue={workCenter ?? ''}
            className="h-10 max-w-[18rem] rounded-md border border-mist-metal bg-white px-3 text-base text-graphite"
          >
            <option value="">Все РЦ</option>
            {workCenters.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
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
