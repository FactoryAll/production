import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

/**
 * Смена СВОЕГО пароля из списка пользователей (ОПЭ-82, 12.11.2026).
 *
 * Владелец в первый день работы упёрся: «Сбросить пароль» в своей строке отвечал отказом
 * «смените на экране «Смена пароля»», а входа на тот экран в интерфейсе не было. Теперь
 * своя строка открывает форму смены своего пароля, которая требует текущий пароль и
 * не завершает сессии.
 */

const changePasswordAction = vi.fn();
const resetPasswordAction = vi.fn();
const refresh = vi.fn();

vi.mock('@/app/change-password/actions', () => ({
  changePasswordAction: (...args: unknown[]) => changePasswordAction(...args),
}));

vi.mock('../actions', () => ({
  resetPasswordAction: (...args: unknown[]) => resetPasswordAction(...args),
  toggleUserActiveAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

import { UsersTable } from '../_components/users-table';

function user(overrides: Record<string, unknown>) {
  return {
    passwordHash: 'hash',
    employeeId: null,
    active: true,
    mustChangePassword: false,
    notificationScope: 'ALL' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    employee: null,
    roles: [{ role: { id: 'role-adm', code: 'ADM', name: 'Администратор', createdAt: new Date(), updatedAt: new Date() } }],
    ...overrides,
  };
}

const tableProps = {
  users: [
    user({ id: 'user-self', login: 'admin' }),
    user({ id: 'user-other', login: 'operator' }),
  ],
  searchParams: {},
  currentUserId: 'user-self',
} as unknown as Parameters<typeof UsersTable>[0];

function renderTable() {
  return render(<UsersTable {...tableProps} />);
}

describe('Своя строка в списке пользователей', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('у своей строки — «Сменить свой пароль», у чужой — «Сбросить пароль»', () => {
    renderTable();

    const ownRow = screen.getByRole('row', { name: /admin/ });
    const otherRow = screen.getByRole('row', { name: /operator/ });

    expect(within(ownRow).getByRole('button', { name: 'Сменить свой пароль' })).toBeDefined();
    expect(within(ownRow).queryByRole('button', { name: 'Сбросить пароль' })).toBeNull();

    expect(within(otherRow).getByRole('button', { name: 'Сбросить пароль' })).toBeDefined();
    expect(within(otherRow).queryByRole('button', { name: 'Сменить свой пароль' })).toBeNull();
  });

  it('форма смены своего пароля спрашивает текущий, новый и подтверждение', () => {
    renderTable();

    fireEvent.click(screen.getByRole('button', { name: 'Сменить свой пароль' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Текущий пароль')).toBeDefined();
    expect(within(dialog).getByLabelText('Новый пароль')).toBeDefined();
    expect(within(dialog).getByLabelText('Повторите новый пароль')).toBeDefined();
    // Отказа «свой пароль так не сбрасывается» в интерфейсе больше нет.
    expect(screen.queryByText(/Свой пароль так не сбрасывается/)).toBeNull();
  });

  it('отправляет три поля в changePasswordAction и не трогает сброс пароля', async () => {
    changePasswordAction.mockResolvedValue({ success: true });
    renderTable();

    fireEvent.click(screen.getByRole('button', { name: 'Сменить свой пароль' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Текущий пароль'), { target: { value: 'old-pass' } });
    fireEvent.change(within(dialog).getByLabelText('Новый пароль'), { target: { value: 'NewPass1234' } });
    fireEvent.change(within(dialog).getByLabelText('Повторите новый пароль'), { target: { value: 'NewPass1234' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сменить пароль' }));

    await waitFor(() => expect(changePasswordAction).toHaveBeenCalledTimes(1));
    const formData = changePasswordAction.mock.calls[0][0] as FormData;
    expect(formData.get('currentPassword')).toBe('old-pass');
    expect(formData.get('newPassword')).toBe('NewPass1234');
    expect(formData.get('confirmPassword')).toBe('NewPass1234');

    // Сброс (с выдачей временного пароля и завершением сессий) не вызывался вовсе.
    expect(resetPasswordAction).not.toHaveBeenCalled();
  });

  it('после успеха говорит, что сессии не завершены', async () => {
    changePasswordAction.mockResolvedValue({ success: true });
    renderTable();

    fireEvent.click(screen.getByRole('button', { name: 'Сменить свой пароль' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Текущий пароль'), { target: { value: 'old' } });
    fireEvent.change(within(dialog).getByLabelText('Новый пароль'), { target: { value: 'NewPass1234' } });
    fireEvent.change(within(dialog).getByLabelText('Повторите новый пароль'), { target: { value: 'NewPass1234' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сменить пароль' }));

    // Текст подтверждения разбит на элементы (логин выделен), поэтому сверяем текстовое
    // содержимое диалога целиком, а не один узел.
    await waitFor(() => {
      const text = screen.getByRole('dialog').textContent ?? '';
      expect(text).toContain('изменён');
      expect(text).toContain('Открытые сессии не');
      expect(text).toContain('завершены');
    });
  });

  it('несовпадение подтверждения не отправляет запрос', async () => {
    renderTable();

    fireEvent.click(screen.getByRole('button', { name: 'Сменить свой пароль' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Текущий пароль'), { target: { value: 'old' } });
    fireEvent.change(within(dialog).getByLabelText('Новый пароль'), { target: { value: 'NewPass1234' } });
    fireEvent.change(within(dialog).getByLabelText('Повторите новый пароль'), { target: { value: 'Другое1234' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сменить пароль' }));

    expect(await within(dialog).findByText('Пароли не совпадают')).toBeDefined();
    expect(changePasswordAction).not.toHaveBeenCalled();
  });

  it('ошибку сервера показывает вместо молчания', async () => {
    changePasswordAction.mockResolvedValue({ error: 'Неверный текущий пароль' });
    renderTable();

    fireEvent.click(screen.getByRole('button', { name: 'Сменить свой пароль' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Текущий пароль'), { target: { value: 'wrong' } });
    fireEvent.change(within(dialog).getByLabelText('Новый пароль'), { target: { value: 'NewPass1234' } });
    fireEvent.change(within(dialog).getByLabelText('Повторите новый пароль'), { target: { value: 'NewPass1234' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сменить пароль' }));

    expect(await within(dialog).findByText('Неверный текущий пароль')).toBeDefined();
  });
});
