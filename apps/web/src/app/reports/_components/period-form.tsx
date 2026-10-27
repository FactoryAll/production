import { currentMonth, monthLabel } from '@/lib/reports/period';

/**
 * Выбор периода отчёта (решение владельца 26.10.2026): смена, день, неделя, месяц.
 * Месяцев можно отметить несколько — тогда отчёт собирается по каждому из них.
 *
 * Форма обычная, отправляется методом GET: фильтры остаются в адресе, ссылку можно
 * переслать, а выгрузка строится по тем же параметрам.
 */
export function PeriodForm({
  action,
  period,
  months,
  from,
  to,
  shifts,
  category,
}: {
  action: string;
  period: string;
  months: string[];
  from: string;
  to: string;
  /** Последние смены для режима «смена». */
  shifts: Array<{ id: string; label: string; date: string }>;
  /** Если задано — показываем выбор категории выпуска (отчёт по номенклатуре). */
  category?: string;
}) {
  // Последние 14 месяцев: больше в одном отчёте всё равно не просматривают.
  const today = new Date();
  const monthOptions = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth() - index, 1);
    const value = currentMonth(date);
    return { value, label: monthLabel(value) };
  });

  return (
    <form method="get" action={action} className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-steel-graphite">Период</span>
        <select
          name="period"
          defaultValue={period}
          className="h-10 rounded-md border border-mist-metal bg-white px-3 text-base text-graphite"
        >
          <option value="months">Месяцы</option>
          <option value="day">День</option>
          <option value="week">Неделя</option>
          <option value="shift">Смена</option>
        </select>
      </label>

      <details className="text-sm">
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

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-steel-graphite">Смена</span>
        <select
          name="shiftId"
          defaultValue={shifts[0]?.id ?? ''}
          className="h-10 max-w-[16rem] rounded-md border border-mist-metal bg-white px-3 text-base text-graphite"
        >
          {shifts.map((shift) => (
            <option key={shift.id} value={shift.id}>
              {shift.label}
            </option>
          ))}
        </select>
      </label>

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
