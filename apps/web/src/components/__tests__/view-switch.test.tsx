import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ViewSwitch } from '../view-switch';

/**
 * Переключатель «Список | Канбан» (T-103, решение владельца 30.10.2026).
 *
 * Половинка видна только тому, у кого есть право на соответствующий вид: у складских ролей
 * нет права на список ПЗ, и ссылка вела бы их в отказ доступа. Активная половина — подпись,
 * а не ссылка: «переключиться в текущий вид» — действие без смысла.
 */
describe('переключатель видов', () => {
  it('на доске: «Список» — ссылка, «Канбан» — подпись с aria-current', () => {
    render(<ViewSwitch current="board" listHref="/production-orders" boardHref="/kanban" />);

    const list = screen.getByRole('link', { name: 'Список' });
    expect(list.getAttribute('href')).toBe('/production-orders');

    const board = screen.getByText('Канбан');
    expect(board.getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('link', { name: 'Канбан' })).toBeNull();
  });

  it('на списке: «Канбан» — ссылка, «Список» — подпись', () => {
    render(<ViewSwitch current="list" listHref="/production-orders" boardHref="/kanban" />);

    expect(screen.getByRole('link', { name: 'Канбан' }).getAttribute('href')).toBe('/kanban');
    expect(screen.getByText('Список').getAttribute('aria-current')).toBe('page');
  });

  it('без права на вид половина не рендерится (КСГП: нет списка ПЗ)', () => {
    render(<ViewSwitch current="board" listHref={null} boardHref="/kanban" />);

    expect(screen.queryByRole('link', { name: 'Список' })).toBeNull();
    expect(screen.queryByText('Список')).toBeNull();
    expect(screen.getByText('Канбан').getAttribute('aria-current')).toBe('page');
  });

  it('без прав на оба вида переключателя нет вовсе', () => {
    const { container } = render(<ViewSwitch current="list" listHref={null} boardHref={null} />);
    expect(container.firstChild).toBeNull();
  });
});
