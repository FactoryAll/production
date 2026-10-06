import { describe, it, expect, vi, beforeEach } from 'vitest';

const tx = {
  notification: { deleteMany: vi.fn().mockResolvedValue({ count: 4 }) },
  productionOrder: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
};

vi.mock('@prodtrack/db', () => ({
  prisma: { $transaction: vi.fn(async (cb: (client: unknown) => Promise<unknown>) => cb(tx)) },
  writeAudit: vi.fn(),
}));
vi.mock('@/lib/auth/session', () => ({ requireSession: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { writeAudit } from '@prodtrack/db';
import { requireSession } from '@/lib/auth/session';
import { clearDataAction } from '../actions';

function mockSession(roles: string[]) {
  (requireSession as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: 'user-1',
    user: { id: 'user-1', roles: roles.map((code) => ({ role: { code } })) },
  });
}

describe('Очистка данных: серверное действие (T-076)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession(['ADM']);
  });

  it('доступна только администратору', async () => {
    mockSession(['NP']);

    const result = await clearDataAction(['notifications'], 'ОЧИСТИТЬ');

    expect(result.success).toBe(false);
    expect(result.error).toContain('только администратору');
  });

  it('без подтверждающего слова ничего не удаляет', async () => {
    const result = await clearDataAction(['notifications'], 'очистить всё');

    expect(result.success).toBe(false);
    expect(result.error).toContain('ОЧИСТИТЬ');
    expect(tx.notification.deleteMany).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it('требует выбрать хотя бы одну группу', async () => {
    const result = await clearDataAction([], 'ОЧИСТИТЬ');

    expect(result.success).toBe(false);
    expect(result.error).toContain('хотя бы одну группу');
  });

  it('чистит выбранные группы, пишет аудит и возвращает число удалённых записей', async () => {
    const result = await clearDataAction(['orders', 'notifications'], 'ОЧИСТИТЬ');

    expect(result.success).toBe(true);
    expect(tx.notification.deleteMany).toHaveBeenCalled();
    expect(tx.productionOrder.deleteMany).toHaveBeenCalled();
    expect(result.removed?.map((item) => item.key)).toEqual(['notifications', 'orders']);

    const audit = (writeAudit as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(audit.action).toBe('DELETE');
    expect(audit.objectType).toBe('DataCleanup');
    expect(audit.role).toBe('ADM');
    expect(audit.newValue).toContain('notifications');
  });
});
