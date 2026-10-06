import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/session', () => ({ requireSession: vi.fn() }));
vi.mock('@prodtrack/db', () => {
  const counter = () => ({ count: vi.fn().mockResolvedValue(0) });
  return {
    prisma: {
      notification: counter(),
      stageTiming: counter(),
      taskForOneC: counter(),
      goodsTransfer: counter(),
      transferLine: counter(),
      discrepancy: counter(),
      productionFact: counter(),
      factConsumption: counter(),
      shiftSummary: counter(),
      shiftSummaryConsumption: counter(),
      stockMovement: counter(),
      stockBalance: counter(),
      productionOrder: counter(),
      productionOrderLine: counter(),
      productionOrderLineWorkers: counter(),
    },
  };
});

import { requireSession } from '@/lib/auth/session';
import { AccessDenied } from '@/components/access-denied';
import DataCleanupPage from '../_client-page';
import DataCleanupServerPage from '../page';

function mockSession(roles: string[]) {
  (requireSession as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: 'user-1',
    user: { id: 'user-1', roles: roles.map((code) => ({ role: { code } })) },
  });
}

function propsOf(element: unknown): Record<string, unknown> {
  return (element as { props: Record<string, unknown> }).props;
}

describe('Экран «Данные»: доступ и состав групп (T-076)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('роль без прав администратора получает экран «Доступ запрещён», а не 500', async () => {
    mockSession(['NP']);

    const element = await DataCleanupServerPage();

    expect(element.type).toBe(AccessDenied);
  });

  it('администратору показывает группы данных с числом записей', async () => {
    mockSession(['ADM']);

    const element = await DataCleanupServerPage();

    expect(element.type).toBe(DataCleanupPage);
    const groups = propsOf(element).groups as { key: string; records: number }[];
    expect(groups).toHaveLength(8);
    expect(groups.map((group) => group.key)).toContain('orders');
  });
});
