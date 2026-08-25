import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

describe('changePasswordAction', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function setupMocks(passwordMocks: Record<string, unknown> = {}) {
    const user = {
      id: 'user-1',
      passwordHash: 'hashed-old',
      mustChangePassword: true,
      roles: [{ role: { code: 'ADM' } }],
    };

    vi.doMock('@/lib/auth/session', () => ({
      requireSession: vi.fn().mockResolvedValue({ userId: user.id, user }),
    }));

    vi.doMock('@/lib/auth/password', () => ({
      hashPassword: vi.fn().mockResolvedValue('hashed-new'),
      verifyPassword: vi.fn().mockResolvedValue(true),
      ...passwordMocks,
    }));

    vi.doMock('@prodtrack/db', async () => {
      const actual = await vi.importActual<typeof import('@prodtrack/db')>('@prodtrack/db');
      return {
        ...actual,
        prisma: {
          $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
            const mockTx = {
              user: { update: vi.fn().mockResolvedValue({ id: user.id }) },
            };
            return cb(mockTx);
          }),
        },
        writeAudit: vi.fn(),
      };
    });

    const { changePasswordAction } = await import('./actions');
    const { prisma, writeAudit } = await import('@prodtrack/db');
    const { hashPassword, verifyPassword } = await import('@/lib/auth/password');
    return { changePasswordAction, prisma, writeAudit, hashPassword, verifyPassword, user };
  }

  it('changes password with correct current password', async () => {
    const { changePasswordAction, writeAudit } = await setupMocks();
    const formData = new FormData();
    formData.set('currentPassword', 'old-pass-1');
    formData.set('newPassword', 'NewPass123');
    formData.set('confirmPassword', 'NewPass123');

    const result = await changePasswordAction(formData);

    expect(result).toEqual({ success: true });
    expect(writeAudit).toHaveBeenCalled();
    const auditCall = (writeAudit as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(auditCall.role).toBe('ADM');
  });

  it('returns error when current password is invalid', async () => {
    const { changePasswordAction } = await setupMocks({ verifyPassword: vi.fn().mockResolvedValue(false) });

    const formData = new FormData();
    formData.set('currentPassword', 'wrong-password');
    formData.set('newPassword', 'NewPass123');
    formData.set('confirmPassword', 'NewPass123');

    const result = await changePasswordAction(formData);

    expect(result.error).toBe('Неверный текущий пароль');
  });

  it('returns validation error for weak new password', async () => {
    const { changePasswordAction } = await setupMocks();
    const formData = new FormData();
    formData.set('currentPassword', 'old-pass-1');
    formData.set('newPassword', 'short1');
    formData.set('confirmPassword', 'short1');

    const result = await changePasswordAction(formData);

    expect(result.error).toContain('Пароль должен содержать не менее 8 символов');
  });

  it('returns error when new password and confirmation differ', async () => {
    const { changePasswordAction } = await setupMocks();
    const formData = new FormData();
    formData.set('currentPassword', 'old-pass-1');
    formData.set('newPassword', 'NewPass123');
    formData.set('confirmPassword', 'Different123');

    const result = await changePasswordAction(formData);

    expect(result.error).toBe('Пароли не совпадают');
  });
});
