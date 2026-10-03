import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AccessDenied } from '../access-denied';

describe('AccessDenied (T-067)', () => {
  it('показывает действие и роли, которым оно доступно', () => {
    render(
      <AccessDenied
        action="приёмка перемещения"
        allowedRoles={['KSGP', 'ADM']}
        requiredPermission="transfer:receive"
      />,
    );

    expect(screen.getByText('Доступ запрещён')).toBeTruthy();
    expect(screen.getByText(/приёмка перемещения/)).toBeTruthy();
    expect(screen.getByText(/Кладовщик склада ГП \(КСГП\)/)).toBeTruthy();
    expect(screen.getByText(/Администратор \(АДМ\)/)).toBeTruthy();
    expect(screen.getByText(/требуется право transfer:receive/)).toBeTruthy();
  });

  it('работает без перечня ролей и кода права', () => {
    render(<AccessDenied action="просмотр остатков" />);

    expect(screen.getByText('Доступ запрещён')).toBeTruthy();
    expect(screen.getByText(/просмотр остатков/)).toBeTruthy();
  });

  it('показывает неизвестную роль как есть', () => {
    render(<AccessDenied action="просмотр" allowedRoles={['UNKNOWN']} />);

    expect(screen.getByText(/UNKNOWN/)).toBeTruthy();
  });

  it('содержит ссылку возврата на главную', () => {
    render(<AccessDenied action="просмотр" />);

    const link = screen.getByRole('link', { name: /Вернуться на главную/ });
    expect(link.getAttribute('href')).toBe('/dashboard');
  });
});
