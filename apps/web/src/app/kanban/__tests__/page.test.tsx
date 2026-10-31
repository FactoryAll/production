import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

vi.mock('@/lib/auth/page-guard', () => ({ checkPageAccess: vi.fn() }));

const lineFindMany = vi.fn();
const shiftFindMany = vi.fn();
const taskFindMany = vi.fn();
const transferFindMany = vi.fn();

/**
 * Строки отдаём с честным фильтром по смене: иначе тест «срез по смене» ничего бы не проверял —
 * без фильтра доска увидела бы строку другой смены в моке.
 */
async function filteredLines(args: unknown) {
  const where = (args as { where?: Record<string, unknown> } | undefined)?.where ?? {};
  const order = (where.order ?? {}) as { shiftId?: string | { not?: string } };
  const needsTransfers = Boolean((where.transferLines as { some?: unknown } | undefined)?.some);
  const rows = (await lineFindMany(args)) as Array<{ order: { shiftId: string }; transferLines?: unknown[] }>;

  return rows.filter((row) => {
    const shiftId = order.shiftId;
    if (typeof shiftId === 'string' && row.order.shiftId !== shiftId) return false;
    if (shiftId && typeof shiftId === 'object' && shiftId.not && row.order.shiftId === shiftId.not) return false;
    if (needsTransfers && (row.transferLines ?? []).length === 0) return false;
    return true;
  });
}

vi.mock('@prodtrack/db', () => ({
  prisma: {
    shift: { findMany: (...args: unknown[]) => shiftFindMany(...args) },
    productionOrderLine: { findMany: (args: unknown) => filteredLines(args) },
    taskForOneC: { findMany: (...args: unknown[]) => taskFindMany(...args) },
    goodsTransfer: { findMany: (...args: unknown[]) => transferFindMany(...args) },
    workCenter: { findMany: vi.fn().mockResolvedValue([]) },
    product: { findMany: vi.fn().mockResolvedValue([]) },
    warehouse: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

import { checkPageAccess } from '@/lib/auth/page-guard';
import { AccessDenied } from '@/components/access-denied';
import KanbanPage from '../page';

/**
 * Экран доски (T-103, этап 4).
 *
 * Требования владельца, которые проверяются здесь: десять колонок с числом карточек,
 * пустые состояния тремя текстами, клик на экран действия по правилам этапа, подпись
 * «ожидает 1С / проведено» и подпись фильтра «склад (для перемещений)».
 */
const SHIFT = {
  id: 'shift-1',
  number: 2,
  date: new Date('2026-10-30T00:00:00'),
  start: '08:00',
  end: '20:00',
};

function gpLine(overrides: Record<string, unknown> = {}) {
  return {
    id: 'line-1',
    plannedQuantity: { toString: () => '40' },
    status: 'REPORTED',
    operator: { fullName: 'Иванов И.И.' },
    workCenter: { code: '03', name: 'Тубировка крем' },
    product: { code: 'GP002', name: 'Готовая продукция Б', unit: 'шт' },
    facts: [{ factCategory: 'GP', quantity: { toString: () => '45' } }],
    order: { id: 'po-12345678', status: 'COMPLETED', shiftId: SHIFT.id },
    transferLines: [],
    ...overrides,
  };
}

function mockAccess(roles: string[], allowed = true) {
  (checkPageAccess as ReturnType<typeof vi.fn>).mockResolvedValue({
    allowed,
    roles,
    session: { userId: 'user-1', user: { id: 'user-1', roles: roles.map((code) => ({ role: { code } })) } },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  shiftFindMany.mockResolvedValue([SHIFT]);
  lineFindMany.mockResolvedValue([]);
  taskFindMany.mockResolvedValue([]);
  transferFindMany.mockResolvedValue([]);
});

describe('Экран «Канбан»: доступ', () => {
  it('роль без kanban:read получает экран «Доступ запрещён»', async () => {
    mockAccess(['GUEST'], false);

    const element = await KanbanPage({ searchParams: {} });

    expect(element.type).toBe(AccessDenied);
    expect(lineFindMany).not.toHaveBeenCalled();
  });
});

describe('Экран «Канбан»: пустые состояния', () => {
  it('смен нет — «В базе нет смен»', async () => {
    mockAccess(['NP']);
    shiftFindMany.mockResolvedValue([]);

    render((await KanbanPage({ searchParams: {} })) as never);

    expect(screen.getByText(/В базе нет смен/)).toBeTruthy();
  });

  it('строк за смену нет — подсказка сменить фильтр', async () => {
    mockAccess(['NP']);

    render((await KanbanPage({ searchParams: {} })) as never);

    expect(screen.getByText(/За выбранную смену строк нет/)).toBeTruthy();
  });

  it('складской роли без строк говорится про перемещения, а не про ПЗ', async () => {
    mockAccess(['KSGP']);

    render((await KanbanPage({ searchParams: {} })) as never);

    expect(screen.getByText('За выбранную смену перемещений нет.')).toBeTruthy();
    expect(screen.queryByText(/За выбранную смену строк нет/)).toBeNull();
  });
});

describe('Экран «Канбан»: колонки и карточки', () => {
  it('десять колонок с числом карточек, подпись 1С и фильтр по складу', async () => {
    mockAccess(['NP']);
    lineFindMany.mockResolvedValue([gpLine()]);

    render((await KanbanPage({ searchParams: {} })) as never);

    // Колонки: заголовок + число. Пустая колонка показывает «—», а не пустоту.
    const closed = screen.getByRole('region', { name: 'Закрыто / задача 1С' });
    expect(within(closed).getByText('1')).toBeTruthy();
    expect(within(closed).getByText('ожидает 1С')).toBeTruthy();

    const draft = screen.getByRole('region', { name: 'Черновик ПЗ' });
    expect(within(draft).getByText('—')).toBeTruthy();
    expect(within(draft).getByText('0')).toBeTruthy();

    // Подпись фильтра — как просил владелец: склад действует только на перемещения.
    expect(screen.getByText('Склад (для перемещений)')).toBeTruthy();
    // Все четыре фильтра на месте.
    expect(screen.getByLabelText('Смена')).toBeTruthy();
    expect(screen.getByLabelText('РЦ')).toBeTruthy();
    expect(screen.getByLabelText('Номенклатура')).toBeTruthy();
  });

  it('карточка закрытого ПЗ ведёт в карточку ПЗ с якорем на строку', async () => {
    mockAccess(['NP']);
    lineFindMany.mockResolvedValue([gpLine()]);

    render((await KanbanPage({ searchParams: {} })) as never);

    const card = screen.getByRole('link', { name: /ПЗ po-12345/ });
    expect(card.getAttribute('href')).toBe('/production-orders/po-12345678#line-line-1');
    expect(within(card).getByText(/РЦ 03 — Тубировка крем/)).toBeTruthy();
    expect(within(card).getByText(/План 40 шт · факт 45 шт/)).toBeTruthy();
    expect(within(card).getByText(/Оператор: Иванов И.И./)).toBeTruthy();
  });

  it('карточка перемещения самостоятельная: номенклатура, количество, склады, ссылка', async () => {
    mockAccess(['KSGP']);
    transferFindMany.mockResolvedValue([
      {
        id: 'tr-1',
        status: 'SUBMITTED',
        createdAt: new Date('2026-10-30T09:00:00'),
        updatedAt: new Date('2026-10-30T12:00:00'),
        submittedAt: new Date('2026-10-30T12:00:00'),
        sourceWarehouse: { id: 'wh-prod', name: 'Производственный склад' },
        destinationWarehouse: { id: 'wh-gp', name: 'Склад ГП' },
        lines: [
          {
            product: { code: 'GP002', name: 'Готовая продукция Б', unit: 'шт' },
            plannedQuantity: { toString: () => '10' },
          },
        ],
      },
    ]);

    render((await KanbanPage({ searchParams: {} })) as never);

    const card = screen.getByRole('link', { name: /Перемещение/ });
    expect(card.getAttribute('href')).toBe('/transfers/tr-1');
    expect(within(card).getByText(/GP002 — Готовая продукция Б/)).toBeTruthy();
    expect(within(card).getByText(/10 шт/)).toBeTruthy();
    expect(within(card).getByText(/Производственный склад → Склад ГП/)).toBeTruthy();
    expect(screen.getByText('в пути')).toBeTruthy();
  });

  it('складской роли колонки ПЗ не рендерятся, а «Отменено» — есть', async () => {
    mockAccess(['KSGP']);
    // Карточка должна быть видна складской роли, иначе страница покажет пустое состояние
    // вместо колонок: у КСГП строки ПЗ скрыты, остаются перемещения.
    transferFindMany.mockResolvedValue([
      {
        id: 'tr-1',
        status: 'RECEIVED',
        createdAt: new Date('2026-10-30T09:00:00'),
        updatedAt: new Date('2026-10-30T15:00:00'),
        submittedAt: new Date('2026-10-30T12:00:00'),
        sourceWarehouse: { id: 'wh-prod', name: 'Производственный склад' },
        destinationWarehouse: { id: 'wh-gp', name: 'Склад ГП' },
        lines: [
          {
            product: { code: 'GP002', name: 'Готовая продукция Б', unit: 'шт' },
            plannedQuantity: { toString: () => '10' },
          },
        ],
      },
    ]);

    render((await KanbanPage({ searchParams: {} })) as never);

    expect(screen.queryByRole('region', { name: 'Черновик ПЗ' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Закрыто / задача 1С' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Перемещение создано' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Отменено' })).toBeTruthy();
  });

  // ОПЭ-74, дефект 1: доска — срез по выбранной смене, и перемещение другой смены сюда
  // не попадает. Подсказка объясняет, что данные есть, а не создаёт вид потери.
  it('подсказывает про другие смены, если в выбранной смене перемещений нет', async () => {
    mockAccess(['NP']);
    // Перемещение за другую смену: доска его не покажет, но подсказка должна появиться.
    shiftFindMany.mockResolvedValue([
      SHIFT,
      { id: 'shift-2', number: 2, date: new Date('2026-10-31T00:00:00'), start: '08:00', end: '20:00' },
    ]);
    transferFindMany.mockResolvedValue([
      {
        id: 'tr-1',
        status: 'DRAFT',
        createdAt: new Date('2026-10-31T09:00:00'),
        updatedAt: new Date('2026-10-31T09:00:00'),
        submittedAt: null,
        sourceWarehouse: { id: 'wh-prod', name: 'Производственный склад' },
        destinationWarehouse: { id: 'wh-gp', name: 'Склад ГП' },
        lines: [
          {
            product: { code: 'GP002', name: 'Готовая продукция Б', unit: 'шт' },
            plannedQuantity: { toString: () => '10' },
          },
        ],
      },
    ]);

    // Смена задана явно: «текущая смена» в тесте зависела бы от календарной даты прогона.
    render((await KanbanPage({ searchParams: { shiftId: 'shift-1' } })) as never);

    expect(screen.getByRole('note')).toBeTruthy();
    expect(screen.getByText(/есть за 1 другую\(-их\) смену\(ы\)/)).toBeTruthy();
    expect(screen.getByText(/Доска показывает только одну смену/)).toBeTruthy();
  });

  it('без перемещений в других сменах подсказки нет', async () => {
    mockAccess(['NP']);

    render((await KanbanPage({ searchParams: { shiftId: 'shift-1' } })) as never);

    expect(screen.queryByRole('note')).toBeNull();
  });

  it('заголовок страницы показывает смену', async () => {
    mockAccess(['NP']);

    render((await KanbanPage({ searchParams: {} })) as never);

    expect(screen.getByText(/Смена: Смена 2 от 30\.10\.2026/)).toBeTruthy();
  });
});
