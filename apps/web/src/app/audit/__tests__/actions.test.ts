import { describe, it, expect, vi, beforeEach } from 'vitest';
import { archiveOldAuditRecords } from '@prodtrack/db';
import { requireSession } from '@/lib/auth/session';
import { revalidatePath } from 'next/cache';
import { archiveOldAuditAction } from '../actions';

vi.mock('@prodtrack/db', () => ({
  prisma: {},
  archiveOldAuditRecords: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({
  requireSession: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

function sessionWithRole(code: string) {
  return {
    userId: 'user-1',
    user: { id: 'user-1', active: true, roles: [{ role: { code } }] },
  };
}

describe('archiveOldAuditAction (T-049, Р-16)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('архивирует старые записи по запросу АДМ', async () => {
    (requireSession as ReturnType<typeof vi.fn>).mockResolvedValue(sessionWithRole('ADM'));
    (archiveOldAuditRecords as ReturnType<typeof vi.fn>).mockResolvedValue(5);

    const result = await archiveOldAuditAction();

    expect(result).toEqual({ success: true, archived: 5 });
    expect(archiveOldAuditRecords).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith('/audit');
  });

  it('запрещает архивацию остальным ролям', async () => {
    (requireSession as ReturnType<typeof vi.fn>).mockResolvedValue(sessionWithRole('NP'));

    const result = await archiveOldAuditAction();

    expect(result).toEqual({
      success: false,
      error: 'Архивация аудита доступна только администратору (Р-16)',
    });
    expect(archiveOldAuditRecords).not.toHaveBeenCalled();
  });

  it('сообщает об ошибке архивации', async () => {
    (requireSession as ReturnType<typeof vi.fn>).mockResolvedValue(sessionWithRole('ADM'));
    (archiveOldAuditRecords as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('База недоступна'),
    );

    const result = await archiveOldAuditAction();

    expect(result).toEqual({ success: false, error: 'База недоступна' });
  });
});
