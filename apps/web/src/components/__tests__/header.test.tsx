import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { Header } from '../header';

function userWith(roles: string[]) {
  return { login: 'tester', roles: roles.map((code) => ({ role: { code } })) };
}

describe('Шапка: выпадающее меню «Администрирование»', () => {
  it('администратору показывает все пункты администрирования', () => {
    render(<Header user={userWith(['ADM'])} />);

    expect(screen.getByRole('button', { name: 'Администрирование' })).toBeDefined();
    for (const label of ['Аудит', 'Данные', 'Роли', 'Пользователи', 'Хронометраж']) {
      expect(screen.getAllByRole('link', { name: label }).length).toBeGreaterThan(0);
    }
  });

  it('оператору оставляет только хронометраж', () => {
    render(<Header user={userWith(['OPR'])} />);

    expect(screen.getAllByRole('link', { name: 'Хронометраж' }).length).toBeGreaterThan(0);
    // Урок Фазы 6: ссылок на недоступные экраны в меню быть не должно.
    for (const label of ['Аудит', 'Данные', 'Роли', 'Пользователи']) {
      expect(screen.queryAllByRole('link', { name: label })).toHaveLength(0);
    }
  });

  it('редкие пункты убраны из основной полосы меню', () => {
    render(<Header user={userWith(['ADM'])} />);

    const nav = screen.getByRole('navigation');
    const directLinks = Array.from(nav.querySelectorAll(':scope > a')).map((link) => link.textContent);

    expect(directLinks).toContain('Дашборд');
    for (const label of ['Аудит', 'Данные', 'Роли', 'Пользователи', 'Хронометраж']) {
      expect(directLinks).not.toContain(label);
    }
  });
});
