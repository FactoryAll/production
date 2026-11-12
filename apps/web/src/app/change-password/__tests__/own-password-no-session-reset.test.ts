import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Смена своего пароля не завершает сессии (ОПЭ-82, 12.11.2026).
 *
 * Требование владельца к форме из списка пользователей: пароль меняется, `mustChangePassword`
 * снимается, аудит пишется — но открытые сессии остаются, иначе администратор выкинул бы
 * сам себя. Проверяем это на самом действии, а не только на диалоге: диалог вызывает
 * `changePasswordAction`, значит его поведение и есть поведение формы.
 */

const userUpdate = vi.fn();
const sessionDeleteMany = vi.fn();
const writeAudit = vi.fn();
const hashPassword = vi.fn(async (password: string) => `hashed:${password}`);
const verifyPassword = vi.fn(async (plain: string, hash: string) => hash === `hash:${plain}`);

vi.mock('@prodtrack/db', () => ({
  prisma: {
    $transaction: async (callback: (tx: unknown) => Promise<void>) =>
      callback({
        user: { update: userUpdate },
        session: { deleteMany: sessionDeleteMany },
      }),
  },
  writeAudit: (...args: unknown[]) => writeAudit(...args),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/password', () => ({
  hashPassword: (...args: unknown[]) => hashPassword(...(args as [string])),
  verifyPassword: (...args: unknown[]) => verifyPassword(...(args as [string, string])),
}));
vi.mock('@/lib/auth/session', () => ({
  requireSession: async () => ({
    userId: 'user-self',
    user: {
      id: 'user-self',
      login: 'admin',
      passwordHash: 'hash:old-pass',
      roles: [{ role: { code: 'ADM' } }],
    },
  }),
}));

import { changePasswordAction } from '../actions';

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}

describe('Смена своего пароля', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('меняет хеш, снимает mustChangePassword и НЕ завершает сессии', async () => {
    const result = await changePasswordAction(
      formData({ currentPassword: 'old-pass', newPassword: 'NewPass1234', confirmPassword: 'NewPass1234' }),
    );

    expect(result.success).toBe(true);
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'user-self' },
      data: { passwordHash: 'hashed:NewPass1234', mustChangePassword: false },
    });
    // Главное требование: сессии остаются, иначе администратор выбросил бы сам себя.
    expect(sessionDeleteMany).not.toHaveBeenCalled();
    // Аудит смены пароля пишется, но без самих паролей.
    expect(writeAudit).toHaveBeenCalledTimes(1);
    const audit = writeAudit.mock.calls[0][1] as { field: string; oldValue: string; newValue: string };
    expect(audit.field).toBe('passwordHash');
    expect(audit.oldValue).toBe('[REDACTED]');
    expect(audit.newValue).toBe('[CHANGED]');
  });

  it('неверный текущий пароль останавливает смену', async () => {
    const result = await changePasswordAction(
      formData({ currentPassword: 'wrong', newPassword: 'NewPass1234', confirmPassword: 'NewPass1234' }),
    );

    expect(result.error).toBe('Неверный текущий пароль');
    expect(userUpdate).not.toHaveBeenCalled();
    expect(sessionDeleteMany).not.toHaveBeenCalled();
  });

  it('несовпадение подтверждения не доходит до записи', async () => {
    const result = await changePasswordAction(
      formData({ currentPassword: 'old-pass', newPassword: 'NewPass1234', confirmPassword: 'Other1234' }),
    );

    expect(result.error).toBe('Пароли не совпадают');
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('слабый пароль отклоняется политикой, хеш не меняется', async () => {
    const result = await changePasswordAction(
      formData({ currentPassword: 'old-pass', newPassword: '123', confirmPassword: '123' }),
    );

    expect(result.error).toBeTruthy();
    expect(userUpdate).not.toHaveBeenCalled();
  });
});
