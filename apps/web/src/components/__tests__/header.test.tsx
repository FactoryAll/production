import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { Header } from '../header';

function userWith(roles: string[]) {
  return { login: 'tester', roles: roles.map((code) => ({ role: { code } })) };
}

describe('Шапка: смена своего пароля доступна из интерфейса', () => {
  // Регресс 12.11.2026: сброс своего пароля через «Пользователи» запрещён намеренно и отвечает
  // «смените на экране «Смена пароля»», а входа на этот экран не было ни в шапке, ни в меню.
  // Сообщение отправляло туда, куда нет дороги — владелец не смог сменить пароль.
  it('ссылка на /change-password есть в шапке', () => {
    render(<Header user={userWith(['ADM'])} />);

    const link = screen.getAllByRole('link', { name: 'Смена пароля' })[0];
    expect(link.getAttribute('href')).toBe('/change-password');
  });

  it('ссылка видна не только администратору: пароль меняет любой', () => {
    for (const role of ['NP', 'OPR', 'KSGP', 'GUEST']) {
      const { unmount } = render(<Header user={userWith([role])} />);
      expect(screen.getAllByRole('link', { name: 'Смена пароля' }).length).toBeGreaterThan(0);
      unmount();
    }
  });

  it('стоит рядом с «Выйти» — там её и ищут', () => {
    render(<Header user={userWith(['NP'])} />);

    const link = screen.getAllByRole('link', { name: 'Смена пароля' })[0];
    const logout = screen.getByRole('button', { name: 'Выйти' });
    // Оба живут в одном блоке правой части шапки: у них общий родитель.
    expect(link.closest('div')).toBe(logout.closest('div'));
  });
});

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
