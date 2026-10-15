import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const resetPasswordAction = vi.fn();

vi.mock('../actions', () => ({
  resetPasswordAction: (...args: unknown[]) => resetPasswordAction(...args),
  toggleUserActiveAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { ResetPasswordButton } from '../_components/reset-password-button';
import { ResetPasswordDialog } from '../_components/reset-password-dialog';
import { UsersTable } from '../_components/users-table';

const tableProps = {
  users: [
    {
      id: 'user-1',
      login: 'operator',
      passwordHash: 'hash',
      employeeId: 'emp-1',
      active: true,
      mustChangePassword: false,
  notificationScope: 'ALL' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      employee: { id: 'emp-1', fullName: 'Оператор Смены', tabNumber: '0001', active: true, canBeWorker: true, createdAt: new Date(), updatedAt: new Date() },
      roles: [{ role: { id: 'role-opr', code: 'OPR', name: 'Оператор', createdAt: new Date(), updatedAt: new Date() } }],
    },
  ],
  searchParams: {},
} as unknown as Parameters<typeof UsersTable>[0];

function openDialog() {
  render(<ResetPasswordButton userId="user-1" login="operator" />);
  fireEvent.click(screen.getByRole('button', { name: 'Сбросить пароль' }));
}

/** Кнопка подтверждения живёт в диалоге: то же имя есть у действия в строке списка. */
function confirmReset() {
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Сбросить пароль' }));
}

describe('Сброс пароля пользователю (Р-15)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  it('спрашивает подтверждение и предупреждает о завершении сессий', () => {
    openDialog();

    expect(screen.getByText(/открытые сессии завершатся/)).toBeDefined();
    expect(resetPasswordAction).not.toHaveBeenCalled();
  });

  it('после сброса показывает временный пароль один раз и даёт его скопировать', async () => {
    resetPasswordAction.mockResolvedValue({ success: true, tempPassword: 'Temp1234Abcd' });
    openDialog();

    confirmReset();

    await waitFor(() => {
      expect(screen.getByText('Temp1234Abcd')).toBeDefined();
    });
    expect(screen.getByText(/показан один раз/)).toBeDefined();
    expect(resetPasswordAction).toHaveBeenCalledWith('user-1');

    fireEvent.click(screen.getByRole('button', { name: 'Скопировать' }));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Temp1234Abcd');
    });
    expect(screen.getByRole('button', { name: 'Скопировано' })).toBeDefined();
  });

  it('показывает отказ, если сброс запрещён', async () => {
    resetPasswordAction.mockResolvedValue({
      success: false,
      error: 'Свой пароль так не сбрасывается: смените его на экране «Смена пароля»',
    });
    openDialog();

    confirmReset();

    await waitFor(() => {
      expect(screen.getByText(/Свой пароль так не сбрасывается/)).toBeDefined();
    });
  });

  it('не теряет показанный пароль при обновлении списка', async () => {
    resetPasswordAction.mockResolvedValue({ success: true, tempPassword: 'Temp1234Abcd' });
    const { rerender } = render(<UsersTable {...tableProps} />);

    fireEvent.click(within(screen.getByRole('row', { name: /operator/ })).getByRole('button', { name: 'Сбросить пароль' }));
    confirmReset();

    await waitFor(() => {
      expect(screen.getByText('Temp1234Abcd')).toBeDefined();
    });

    // После серверного действия страница обновляется и список приходит новыми пропсами.
    // Ячейки таблицы не должны пересоздаваться: иначе диалог закрывается и пароль теряется.
    rerender(<UsersTable {...tableProps} />);

    expect(screen.getByText('Temp1234Abcd')).toBeDefined();
  });

  it('диалог сбрасывает состояние между открытиями', () => {
    // Диалог смонтирован постоянно: без сброса ключа пароль предыдущего сброса остался бы на экране.
    const { unmount } = render(
      <ResetPasswordDialog open onClose={() => {}} userId="user-1" login="operator" />,
    );
    expect(screen.getByText(/Пользователь/)).toBeDefined();
    unmount();

    render(<ResetPasswordDialog open onClose={() => {}} userId="user-2" login="storekeeper" />);
    expect(screen.getByText(/storekeeper/)).toBeDefined();
    expect(screen.queryByText(/Temp1234Abcd/)).toBeNull();
  });
});
