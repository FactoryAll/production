import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/session', () => ({ requireSession: vi.fn() }));
vi.mock('@prodtrack/db', () => ({ prisma: { employee: { findMany: vi.fn() } } }));

import { requireSession } from '@/lib/auth/session';
import { prisma } from '@prodtrack/db';
import EmployeesServerPage from '../page';

describe('Серверная страница сотрудников (T-058)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: 'user-1',
      user: { id: 'user-1', roles: [{ role: { code: 'NP' } }] },
    });
    (prisma.employee.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('применяет поиск, фильтр активности и страницу', async () => {
    const element = await EmployeesServerPage({
      searchParams: { q: '001', active: 'INACTIVE', page: '2' },
    });

    expect(prisma.employee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { tabNumber: { contains: '001', mode: 'insensitive' } },
            { fullName: { contains: '001', mode: 'insensitive' } },
          ],
          active: false,
        },
        skip: 50,
        take: 51,
      }),
    );

    const [listElement] = element.props.children;
    expect(listElement.props.query).toBe('001');
    expect(listElement.props.activeFilter).toBe('INACTIVE');
  });
});
