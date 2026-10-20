import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CheckboxList } from './checkbox-list';

const OPTIONS = [
  { value: 'w1', label: 'Губорев Богдан' },
  { value: 'w2', label: 'Ковex Станислав Игоревич' },
];

describe('CheckboxList', () => {
  // Защита от возврата дефекта с формы ПЗ: пока весь ряд был одним `label`, браузер
  // переключал чекбокс по клику в пустом месте строки (замер: label 1582 px при
  // чекбоксе 16 px, то есть 1558 px мёртвой зоны). Геометрию jsdom не считает,
  // поэтому сторож структурный: чекбокс не должен лежать ВНУТРИ подписи.
  it('не вкладывает чекбокс в label — ряд кликабелен не целиком', () => {
    render(<CheckboxList name="workers" options={OPTIONS} selected={[]} onChange={() => {}} />);

    const checkbox = screen.getByRole('checkbox', { name: 'Губорев Богдан' });
    const label = screen.getByText('Губорев Богдан').closest('label');

    expect(label).not.toBeNull();
    expect(label?.contains(checkbox)).toBe(false);
  });

  it('связывает подпись с чекбоксом через id', () => {
    render(<CheckboxList name="workers" options={OPTIONS} selected={[]} onChange={() => {}} />);

    const checkbox = screen.getByRole('checkbox', { name: 'Губорев Богдан' }) as HTMLInputElement;
    const label = screen.getByText('Губорев Богдан').closest('label');

    expect(checkbox.id).not.toBe('');
    expect(label?.getAttribute('for')).toBe(checkbox.id);
  });

  it('отмечает по клику на подпись', () => {
    const onChange = vi.fn();
    render(<CheckboxList name="workers" options={OPTIONS} selected={[]} onChange={onChange} />);

    fireEvent.click(screen.getByText('Губорев Богдан'));
    expect(onChange).toHaveBeenCalledWith(['w1']);
  });

  it('отмечает по клику на сам чекбокс', () => {
    const onChange = vi.fn();
    render(<CheckboxList name="workers" options={OPTIONS} selected={[]} onChange={onChange} />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Губорев Богдан' }));
    expect(onChange).toHaveBeenCalledWith(['w1']);
  });

  it('снимает отметку повторным кликом', () => {
    const onChange = vi.fn();
    render(<CheckboxList name="workers" options={OPTIONS} selected={['w1']} onChange={onChange} />);

    fireEvent.click(screen.getByText('Губорев Богдан'));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('ряд оформлен контейнером, а не подписью целиком', () => {
    const { container } = render(
      <CheckboxList name="workers" options={OPTIONS} selected={[]} onChange={() => {}} />,
    );

    const row = container.querySelector('div > div');
    expect(row).not.toBeNull();
    expect(row?.tagName).toBe('DIV');
  });
});
