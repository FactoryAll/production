import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/page-guard', () => ({ checkPageAccess: vi.fn() }));
vi.mock('../../users/data', () => ({ listRolesWithPermissionCounts: vi.fn() }));

import { checkPageAccess } from '@/lib/auth/page-guard';
import { listRolesWithPermissionCounts } from '../../users/data';
import { AccessDenied } from '@/components/access-denied';
import RolesPage from '../page';

function mockAccess(roles: string[], allowed = true) {
  (checkPageAccess as ReturnType<typeof vi.fn>).mockResolvedValue({
    allowed,
    roles,
    session: { userId: 'user-1', user: { id: 'user-1', roles: roles.map((code) => ({ role: { code } })) } },
  });
}

describe('Экран «Роли»: доступ и выборка (M02, T-069)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listRolesWithPermissionCounts as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('требует право roles:manage', async () => {
    mockAccess(['ADM']);
    await RolesPage();

    expect(checkPageAccess).toHaveBeenCalledWith('roles:manage');
  });

  it('роль без права roles:manage получает экран «Доступ запрещён», а не 500', async () => {
    mockAccess(['NP'], false);

    const element = await RolesPage();

    expect(element.type).toBe(AccessDenied);
    expect(listRolesWithPermissionCounts).not.toHaveBeenCalled();
  });

  it('АДМ видит список ролей с числом пользователей и прав', async () => {
    mockAccess(['ADM']);
    (listRolesWithPermissionCounts as ReturnType<typeof vi.fn>).mockResolvedValue([
      { code: 'ADM', name: 'Администратор', _count: { users: 1, permissions: 25 } },
    ]);

    const element = await RolesPage();

    expect(element.type).toBe('main');
    expect(listRolesWithPermissionCounts).toHaveBeenCalledTimes(1);
  });
});
