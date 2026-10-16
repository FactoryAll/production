import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock('../actions', () => ({
  toggleUserActiveAction: vi.fn(),
  resetPasswordAction: vi.fn(),
}));

import { UsersTable } from '../_components/users-table';

const props = {
  users: [
    {
      id: 'user-1',
      login: 's1c_mass',
      passwordHash: 'hash',
      employeeId: 'emp-1',
      active: true,
      mustChangePassword: false,
      notificationScope: 'MASS',
      createdAt: new Date(),
      updatedAt: new Date(),
      employee: { id: 'emp-1', fullName: 'Специалист 1С', tabNumber: '0007', active: true, canBeWorker: true, createdAt: new Date(), updatedAt: new Date() },
      roles: [{ role: { id: 'role-s1c', code: 'S1C', name: 'Специалист 1С', createdAt: new Date(), updatedAt: new Date() } }],
    },
  ],
  searchParams: {},
} as unknown as Parameters<typeof UsersTable>[0];

describe('Список пользователей: доступ к карточке', () => {
  it('у каждой строки есть действие «Редактировать», ведущее в карточку', () => {
    render(<UsersTable {...props} />);

    const edit = screen.getByRole('link', { name: 'Редактировать' });
    expect(edit.getAttribute('href')).toBe('/users/user-1/edit');
  });

  it('направление уведомлений задаётся в карточке, а не в списке', () => {
    render(<UsersTable {...props} />);

    // В списке колонки направления нет: настройка живёт в форме пользователя.
    expect(screen.queryByLabelText('Направление уведомлений')).toBeNull();
  });
});
