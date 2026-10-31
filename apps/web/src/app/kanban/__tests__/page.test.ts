import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/page-guard', () => ({ checkPageAccess: vi.fn() }));

import { checkPageAccess } from '@/lib/auth/page-guard';
import { AccessDenied } from '@/components/access-denied';
import KanbanPage from '../page';

/**
 * Маршрут доски контура (T-103, этап 1).
 *
 * Проверяем то, ради чего доска сделана отдельным маршрутом: у неё своё право `kanban:read`,
 * поэтому складские роли на неё попадают, а роли без права получают понятный экран отказа,
 * а не 500. Права на половины переключателя считаются здесь же.
 */
function mockAccess(roles: string[], allowed: boolean) {
  (checkPageAccess as ReturnType<typeof vi.fn>).mockResolvedValue({
    allowed,
    roles,
    session: { userId: 'user-1', user: { id: 'user-1', roles: roles.map((code) => ({ role: { code } })) } },
  });
}

describe('Страница «Канбан»: доступ и переключатель видов (T-103)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('роль без kanban:read получает экран «Доступ запрещён»', async () => {
    mockAccess(['GUEST'], false);

    const element = await KanbanPage({ searchParams: {} });

    expect(element.type).toBe(AccessDenied);
  });

  it('КСГП видит доску, но не получает ссылку на список ПЗ', async () => {
    mockAccess(['KSGP'], true);

    const element = await KanbanPage({ searchParams: {} });

    // Пункт «Список» не рендерится: у КСГП нет production_order:read, список ему закрыт.
    const html = JSON.stringify(element);
    expect(html).toContain('/kanban');
    expect(html).not.toContain('/production-orders');
  });

  it('НП видит обе половины переключателя, и в ссылках остаётся выбранная смена', async () => {
    mockAccess(['NP'], true);

    const element = await KanbanPage({ searchParams: { shiftId: 'shift-1' } });

    const html = JSON.stringify(element);
    expect(html).toContain('/production-orders?shiftId=shift-1');
    expect(html).toContain('/kanban?shiftId=shift-1');
  });

  it('ОТК получает ссылку на список ПЗ: у него есть и ПЗ, и доска', async () => {
    mockAccess(['OTK'], true);

    const element = await KanbanPage({ searchParams: {} });

    // Переключатель собран на сервере, поэтому проверяем адреса, а не текст внутри компонента.
    const html = JSON.stringify(element);
    expect(html).toContain('"/production-orders"');
    expect(html).toContain('"/kanban"');
  });
});
