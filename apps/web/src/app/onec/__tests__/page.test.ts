import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/page-guard', () => ({ checkPageAccess: vi.fn() }));
vi.mock('@/lib/auth/access', () => ({ requireAnyPermission: vi.fn() }));
vi.mock('@prodtrack/db', () => ({
  prisma: { taskForOneC: { findMany: vi.fn(), findUnique: vi.fn() }, user: { findUnique: vi.fn() } },
}));

import { checkPageAccess } from '@/lib/auth/page-guard';
import { prisma } from '@prodtrack/db';
import { AccessDenied } from '@/components/access-denied';
import OneCServerPage from '../page';

/** Ищет ссылку с заданным href в дереве элементов серверного компонента. */
function findHref(node: unknown, href: string): boolean {
  if (Array.isArray(node)) {
    return node.some((child) => findHref(child, href));
  }
  if (typeof node !== 'object' || node === null) {
    return false;
  }

  const element = node as { props?: Record<string, unknown> };
  if (element.props?.href === href) {
    return true;
  }

  return Object.values(element.props ?? {}).some((value) => findHref(value, href));
}

function mockAccess(roles: string[], allowed = true) {
  (checkPageAccess as ReturnType<typeof vi.fn>).mockResolvedValue({
    allowed,
    roles,
    session: { userId: 'user-1', user: { id: 'user-1', roles: roles.map((code) => ({ role: { code } })) } },
  });
}

describe('Экран «Рабочее место 1С»: доступ и выборка (T-051, M12 §3/§8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.taskForOneC.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('роль без права onec:read получает экран «Доступ запрещён», а не 500', async () => {
    mockAccess(['NP'], false);

    const element = await OneCServerPage({ searchParams: {} });

    expect(element.type).toBe(AccessDenied);
    expect(prisma.taskForOneC.findMany).not.toHaveBeenCalled();
  });

  it('читает единый список задач с фильтром по типу и страницей', async () => {
    mockAccess(['S1C']);

    const element = await OneCServerPage({
      searchParams: { type: 'TRANSFER', status: 'PENDING', page: '2' },
    });

    expect(element.type).toBe('main');
    expect(prisma.taskForOneC.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { type: 'TRANSFER', status: 'PENDING' },
        orderBy: [{ status: 'asc' }, { lastChangedAt: 'desc' }],
        skip: 50,
        take: 51,
      }),
    );
  });

  it('ссылка «Экспорт CSV» сохраняет фильтры списка (Р-06)', async () => {
    mockAccess(['S1C']);

    const element = await OneCServerPage({ searchParams: { type: 'TRANSFER', status: 'PENDING' } });

    expect(findHref(element, '/onec/export?type=TRANSFER&status=PENDING')).toBe(true);
  });

  it('без фильтров ссылка экспорта ведёт на общий файл', async () => {
    mockAccess(['S1C']);

    const element = await OneCServerPage({ searchParams: {} });

    expect(findHref(element, '/onec/export')).toBe(true);
  });

  it('неизвестный фильтр типа не сужает выборку', async () => {
    mockAccess(['ADM']);

    await OneCServerPage({ searchParams: { type: 'UNKNOWN', status: 'UNKNOWN' } });

    expect(prisma.taskForOneC.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });
});
