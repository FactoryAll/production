import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/session', () => ({ requireSession: vi.fn() }));
vi.mock('@prodtrack/db', () => ({ prisma: { product: { findMany: vi.fn() } } }));

import { requireSession } from '@/lib/auth/session';
import { prisma } from '@prodtrack/db';
import ProductsServerPage from '../page';

function mockSession(roles: string[]) {
  (requireSession as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: 'user-1',
    user: { id: 'user-1', roles: roles.map((code) => ({ role: { code } })) },
  });
}

describe('Серверная страница номенклатуры (T-058)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession(['ADM']);
    (prisma.product.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('применяет поиск, фильтр активности и страницу из строки запроса', async () => {
    const element = await ProductsServerPage({
      searchParams: { q: 'gp', active: 'ACTIVE', page: '2' },
    });

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { code: { contains: 'gp', mode: 'insensitive' } },
            { name: { contains: 'gp', mode: 'insensitive' } },
          ],
          active: true,
        },
        skip: 50,
        take: 51,
      }),
    );

    const [listElement] = element.props.children;
    expect(listElement.props.query).toBe('gp');
    expect(listElement.props.activeFilter).toBe('ACTIVE');
  });

  it('без параметров показывает первую страницу без фильтров', async () => {
    await ProductsServerPage({ searchParams: {} });

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {}, skip: 0, take: 51 }),
    );
  });

  it('право на управление справочником определяется ролью', async () => {
    mockSession(['OPR']);

    const element = await ProductsServerPage({ searchParams: {} });

    const [listElement] = element.props.children;
    expect(listElement.props.canManage).toBe(false);
  });
});
