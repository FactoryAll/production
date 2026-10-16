import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock('../actions', () => ({
  createUserAction: vi.fn(),
  updateUserAction: vi.fn(),
  resetPasswordAction: vi.fn(),
  toggleUserActiveAction: vi.fn(),
}));

import { UserForm } from '../_components/user-form';

const employee = { id: 'emp-1', fullName: 'Оператор О.О.', tabNumber: '0001' };

function renderForm(overrides: { notificationScope?: string } = {}) {
  return render(
    <UserForm
      mode="edit"
      user={{
        id: 'user-1',
        login: 's1c_mass',
        passwordHash: 'hash',
        mustChangePassword: false,
        active: true,
        employeeId: 'emp-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        notificationScope: overrides.notificationScope ?? 'MASS',
        roles: [{ role: { code: 'S1C' } }],
      } as never}
      employees={[employee]}
      action={vi.fn().mockResolvedValue({ success: true })}
    />,
  );
}

describe('Карточка пользователя: направление уведомлений (ОПЭ, 13.10.2026)', () => {
  it('поле есть и при редактировании существующего пользователя', () => {
    renderForm();

    expect(screen.getByLabelText('Направление уведомлений')).toBeDefined();
    expect(screen.getByText(/Влияет только на уведомления, адресованные роли С1С/)).toBeDefined();
  });

  it('показывает сохранённое направление', () => {
    renderForm({ notificationScope: 'MASS' });

    const select = screen.getByLabelText('Направление уведомлений') as HTMLSelectElement;
    expect(select.value).toBe('MASS');
    expect(select.name).toBe('notificationScope');
  });

  it('у пользователя с направлением «Все» выбран вариант по умолчанию', () => {
    renderForm({ notificationScope: 'ALL' });

    expect((screen.getByLabelText('Направление уведомлений') as HTMLSelectElement).value).toBe('ALL');
  });
});
