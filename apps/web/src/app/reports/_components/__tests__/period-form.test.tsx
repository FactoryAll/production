import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PeriodForm } from '../period-form';

/**
 * Фильтры отчёта (переделка 29.10.2026): показываются только поля выбранного режима,
 * и переключение режима не отправляет форму.
 *
 * Проверяем три вещи: состав полей у каждого режима, что чужих полей нет (иначе в адрес
 * уедут параметры другого режима), и что неделя/смена отдают свои границы и дату.
 */

const WEEKS = [
  { value: '2026-10-26', from: '2026-10-26', to: '2026-11-01', label: '26 октября – 1 ноября 2026' },
  { value: '2026-10-19', from: '2026-10-19', to: '2026-10-25', label: '19–25 октября 2026' },
];

const SHIFTS = [
  { id: 'shift-2', label: 'Смена 2 от 27.10.2026', date: '2026-10-27' },
  { id: 'shift-1', label: 'Смена 1 от 26.10.2026', date: '2026-10-26' },
];

function renderForm(overrides: Partial<Parameters<typeof PeriodForm>[0]> = {}) {
  return render(
    <PeriodForm
      action="/reports/output"
      period="months"
      months={['2026-10']}
      from="2026-10-01"
      to="2026-10-31"
      weeks={WEEKS}
      shifts={SHIFTS}
      {...overrides}
    />,
  );
}

function field(container: HTMLElement, name: string) {
  return container.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLSelectElement | null;
}

function switchMode(mode: string) {
  fireEvent.change(screen.getByLabelText('Период'), { target: { value: mode } });
}

describe('фильтры отчёта: поля зависят от режима', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('«Месяцы» — только месяцы: без дат, недель и смен', () => {
    const { container } = renderForm();

    expect(container.querySelectorAll('input[name="months"]').length).toBeGreaterThan(0);
    expect(field(container, 'from')).toBeNull();
    expect(field(container, 'to')).toBeNull();
    expect(field(container, 'week')).toBeNull();
    expect(field(container, 'shiftId')).toBeNull();
  });

  it('«День» — только «С даты» и «По дату»', () => {
    const { container } = renderForm();

    switchMode('day');

    expect(screen.getByLabelText('С даты')).toBeTruthy();
    expect(screen.getByLabelText('По дату')).toBeTruthy();
    expect(container.querySelectorAll('input[name="months"]')).toHaveLength(0);
    expect(field(container, 'week')).toBeNull();
    expect(field(container, 'shiftId')).toBeNull();
  });

  it('«Неделя» — список недель с подписями и подставленными границами', () => {
    const { container } = renderForm();

    switchMode('week');

    const weekSelect = field(container, 'week') as HTMLSelectElement;
    expect(weekSelect).toBeTruthy();
    expect([...weekSelect.options].map((option) => option.textContent)).toEqual([
      '26 октября – 1 ноября 2026',
      '19–25 октября 2026',
    ]);
    // По умолчанию — первая неделя списка, и её границы едут в адрес.
    expect((field(container, 'from') as HTMLInputElement).value).toBe('2026-10-26');
    expect((field(container, 'to') as HTMLInputElement).value).toBe('2026-11-01');
    // Месяцев в этом режиме нет: иначе в адрес уехали бы лишние параметры.
    expect(container.querySelectorAll('input[name="months"]')).toHaveLength(0);
  });

  it('«Неделя»: выбор другой недели меняет границы периода', () => {
    const { container } = renderForm();

    switchMode('week');
    fireEvent.change(field(container, 'week') as HTMLSelectElement, {
      target: { value: '2026-10-19' },
    });

    expect((field(container, 'from') as HTMLInputElement).value).toBe('2026-10-19');
    expect((field(container, 'to') as HTMLInputElement).value).toBe('2026-10-25');
  });

  it('«Неделя»: на неделе, в которой открыт период, форма открывается этой неделей', () => {
    const { container } = renderForm({ period: 'week', from: '2026-10-19', to: '2026-10-25' });

    expect((field(container, 'week') as HTMLSelectElement).value).toBe('2026-10-19');
    expect((field(container, 'from') as HTMLInputElement).value).toBe('2026-10-19');
    expect((field(container, 'to') as HTMLInputElement).value).toBe('2026-10-25');
  });

  it('«Смена» — только список смен, дата смены уходит скрытым полем', () => {
    const { container } = renderForm();

    switchMode('shift');

    const shiftSelect = field(container, 'shiftId') as HTMLSelectElement;
    expect([...shiftSelect.options].map((option) => option.textContent)).toEqual([
      'Смена 2 от 27.10.2026',
      'Смена 1 от 26.10.2026',
    ]);
    // Без даты серверный разбор брал бы «сегодня» — это и был дефект до переделки.
    expect((field(container, 'shiftDate') as HTMLInputElement).value).toBe('2026-10-27');

    fireEvent.change(shiftSelect, { target: { value: 'shift-1' } });
    expect((field(container, 'shiftDate') as HTMLInputElement).value).toBe('2026-10-26');
    expect((field(container, 'shiftLabel') as HTMLInputElement).value).toBe(
      'Смена 1 от 26.10.2026',
    );
  });

  it('переключение режима не отправляет форму', () => {
    const submitSpy = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});
    renderForm();

    switchMode('day');
    switchMode('week');
    switchMode('shift');

    expect(submitSpy).not.toHaveBeenCalled();
  });

  it('пустые списки недель и смен не роняют форму', () => {
    renderForm({ weeks: [], shifts: [] });

    switchMode('week');
    expect(screen.getByText('Смен в базе нет — недель для выбора тоже нет.')).toBeTruthy();

    switchMode('shift');
    expect(screen.getByText('Смен в базе нет.')).toBeTruthy();
  });
});
