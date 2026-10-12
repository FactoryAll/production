import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SearchSelect, normalizeSearchText } from './search-select';

const OPTIONS = [
  { value: 'p-1', label: 'БП-00000370 – Масса GECO Паста от красителей (кг)' },
  { value: 'p-2', label: 'БП-00000314 – Масса GECO Крем-гель для очистки (кг)' },
  { value: 'p-3', label: 'БП-00000109 – GECO Гель дезинфицирующий, 100 мл (шт)' },
];

function renderSelect(props: Partial<React.ComponentProps<typeof SearchSelect>> = {}) {
  const onChange = vi.fn();
  render(<SearchSelect id="product" value="" onChange={onChange} options={OPTIONS} {...props} />);
  return { onChange, input: screen.getByRole('combobox') as HTMLInputElement };
}

describe('Выбор из списка с поиском', () => {
  it('показывает все варианты при фокусе', () => {
    const { input } = renderSelect();

    fireEvent.focus(input);

    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('фильтрует по вводу: поиск идёт и по коду, и по наименованию', () => {
    const { input } = renderSelect();
    fireEvent.focus(input);

    fireEvent.change(input, { target: { value: 'паста' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByText(/Масса GECO Паста/)).toBeDefined();

    fireEvent.change(input, { target: { value: 'БП-00000109' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByText(/Гель дезинфицирующий/)).toBeDefined();
  });

  it('не зависит от регистра и буквы «ё»', () => {
    render(
      <SearchSelect
        value=""
        onChange={vi.fn()}
        options={[{ value: 'x', label: 'Крем для защиты от укусов' }, { value: 'y', label: 'Крем-гель' }]}
      />,
    );
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);

    fireEvent.change(input, { target: { value: 'КРЕМ' } });
    expect(screen.getAllByRole('option')).toHaveLength(2);

    expect(normalizeSearchText('Крем-Гель')).toBe('крем-гель');
  });

  it('ищет по нескольким словам в любом порядке', () => {
    const { input } = renderSelect();
    fireEvent.focus(input);

    // Порядок слов не важен: подходят и «паста geco», и «geco паста».
    fireEvent.change(input, { target: { value: 'паста geco' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);

    fireEvent.change(input, { target: { value: 'geco паста' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByText(/Масса GECO Паста от красителей/)).toBeDefined();
  });

  it('выбирает вариант по клику и показывает его в поле', () => {
    const { onChange, input } = renderSelect();
    fireEvent.focus(input);

    fireEvent.mouseDown(screen.getByText(/Масса GECO Крем-гель/));

    expect(onChange).toHaveBeenCalledWith('p-2');
  });

  it('выбирает вариант стрелками и Enter', () => {
    const { onChange, input } = renderSelect();
    fireEvent.focus(input);

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith('p-2');
  });

  it('закрывается по Escape без выбора', () => {
    const { onChange, input } = renderSelect();
    fireEvent.focus(input);

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('показывает выбранное значение и позволяет его очистить', () => {
    const { onChange } = renderSelect({ value: 'p-1' });

    expect((screen.getByRole('combobox') as HTMLInputElement).value).toContain('БП-00000370');

    fireEvent.click(screen.getByRole('button', { name: 'Очистить выбор' }));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('сообщает, когда ничего не найдено', () => {
    const { input } = renderSelect();
    fireEvent.focus(input);

    fireEvent.change(input, { target: { value: 'нетакого' } });

    expect(screen.getByText('Ничего не найдено')).toBeDefined();
  });

  it('ограничивает число показанных вариантов', () => {
    const many = Array.from({ length: 60 }, (_, index) => ({ value: 'v' + index, label: 'Позиция ' + index }));
    render(<SearchSelect value="" onChange={vi.fn()} options={many} maxVisible={5} />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);

    expect(screen.getAllByRole('option')).toHaveLength(5);
    expect(screen.getByText(/Показаны первые 5 из 60/)).toBeDefined();
  });

  it('не открывает список, когда выбор недоступен', () => {
    const { input } = renderSelect({ disabled: true });

    fireEvent.focus(input);

    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
