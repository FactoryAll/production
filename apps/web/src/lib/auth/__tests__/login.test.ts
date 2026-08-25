import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import { prisma } from '@prodtrack/db';
import { authenticate } from '../login';

vi.mock('@prodtrack/db', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    auditRecord: { create: vi.fn() },
  },
  AuditAction: {
    LOGIN: 'LOGIN',
    LOGOUT: 'LOGOUT',
    LOGIN_FAILED: 'LOGIN_FAILED',
  },
  writeAudit: vi.fn(async (tx, input) => tx.auditRecord.create({ data: input })),
}));

async function makeUser(overrides = {}) {
  const passwordHash = await bcrypt.hash('admin123', 10);
  return {
    id: 'user-1',
    login: 'admin',
    passwordHash,
    active: true,
    mustChangePassword: false,
    roles: [{ role: { code: 'ADM' } }],
    ...overrides,
  };
}

describe('authenticate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('succeeds with valid credentials and writes LOGIN audit with primary role', async () => {
    const user = await makeUser();
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(user);

    const result = await authenticate('admin', 'admin123', { ip: '127.0.0.1', userAgent: 'test-agent' });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.userId).toBe('user-1');
    expect(result.mustChangePassword).toBe(false);
    expect(prisma.auditRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'LOGIN',
        objectType: 'User',
        objectId: 'user-1',
        userId: 'user-1',
        role: 'ADM',
      }),
    });
  });

  it('fails with wrong password and writes LOGIN_FAILED audit with primary role', async () => {
    const user = await makeUser();
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(user);

    const result = await authenticate('admin', 'wrong');

    expect(result).toEqual({ success: false, error: 'Неверный логин или пароль' });
    expect(prisma.auditRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'LOGIN_FAILED',
        objectId: 'user-1',
        userId: 'user-1',
        role: 'ADM',
      }),
    });
  });

  it('fails for inactive user with blocked message and audit with primary role', async () => {
    const user = await makeUser({ active: false });
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(user);

    const result = await authenticate('admin', 'admin123');

    expect(result).toEqual({ success: false, error: 'Пользователь заблокирован, обратитесь к администратору' });
    expect(prisma.auditRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'LOGIN_FAILED',
        objectId: 'user-1',
        userId: 'user-1',
        role: 'ADM',
      }),
    });
  });

  it('fails for missing user and does not reveal existence', async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await authenticate('unknown', 'admin123');

    expect(result).toEqual({ success: false, error: 'Неверный логин или пароль' });
    expect(prisma.auditRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'LOGIN_FAILED', objectId: 'unknown' }),
    });
  });
});
