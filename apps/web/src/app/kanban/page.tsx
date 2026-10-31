export const dynamic = 'force-dynamic';

import { AccessDenied } from '@/components/access-denied';
import { ViewSwitch } from '@/components/view-switch';
import { checkPageAccess } from '@/lib/auth/page-guard';
import {
  filterKanbanCardsForRoles,
  getKanbanBoard,
  visibleKanbanColumns
} from '@/lib/kanban/board';
import { boardViewHref, listViewHref } from '@/lib/kanban/view-links';
import { hasPermission } from '@prodtrack/contracts';
import { prisma } from '@prodtrack/db';
import { toDateInputValue } from '@/lib/reports/period';

import { KanbanBoard } from './_components/kanban-board';
import { AutoRefresh, RefreshButton } from './_components/auto-refresh';

/**
 * Доска производственного контура (T-103, решение владельца 29.10.2026).
 *
 * Отдельный вид, а не вторая страница-дубль: у доски своё право `kanban:read`, поэтому
 * складские роли (КСГП, УСГП) попадают сюда, хотя на `/production-orders` их не пускает
 * `production_order:read`. Доска ничего не меняет — карточка ведёт на экран действия.
 */
export default async function KanbanPage({
  searchParams
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const access = await checkPageAccess('kanban:read');
  if (!access.allowed) {
    return (
      <AccessDenied
        action="просмотр доски производственного контура"
        allowedRoles={['NP', 'ADM', 'S1C', 'OTK', 'KSGP', 'USGP']}
        requiredPermission="kanban:read"
      />
    );
  }

  const roles = access.roles;
  const param = (name: string): string | undefined => {
    const value = searchParams[name];
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
  };

  const filter = {
    shiftId: param('shiftId'),
    workCenterId: param('workCenterId'),
    productId: param('productId'),
    warehouseId: param('warehouseId')
  };

  // Списки фильтров берутся ИЗ ДОСКИ, а не из каталога (замечание владельца 01.11.2026):
  // показываем только то, что реально есть в карточках за выбранную смену.
  const [board, shifts] = await Promise.all([
    getKanbanBoard(prisma, filter),
    prisma.shift.findMany({
      orderBy: [{ date: 'desc' }, { number: 'desc' }],
      take: 30,
      select: { id: true, number: true, date: true }
    })
  ]);
  const { options: filterOptions } = board;

  const columns = visibleKanbanColumns(roles);
  const cards = filterKanbanCardsForRoles(board.cards, roles);
  const canSeeOrderColumns = hasPermission(roles, 'production_order:read');

  // Пустые состояния — тремя текстами: «смен нет», «строк за смену нет» и «перемещений нет»
  // для складской роли. Иначе пустая доска читается как поломка, а не как пустая смена.
  const transferColumnsEmpty = !canSeeOrderColumns && cards.length === 0;
  return (
    <main className="space-y-4 p-6">
      <AutoRefresh />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-graphite">Канбан производственного контура</h1>
          {board.shift && <p className="text-sm text-steel-graphite">Смена: {board.shift.label}</p>}
        </div>
        <div className="flex items-center gap-3">
          {/* Обновление без F5 (решение владельца 31.10.2026): кнопка рядом с переключателем вида. */}
          <RefreshButton />
          <ViewSwitch
            current="board"
            listHref={canSeeOrderColumns ? listViewHref({ shiftId: board.shift?.id }) : null}
            boardHref={boardViewHref({
              shiftId: board.shift?.id,
              workCenterId: filter.workCenterId,
              productId: filter.productId,
              warehouseId: filter.warehouseId
            })}
          />
        </div>
      </div>

      <form method="get" action="/kanban" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-steel-graphite">Смена</span>
          <select
            name="shiftId"
            defaultValue={filter.shiftId ?? ''}
            className="h-10 max-w-[18rem] rounded-md border border-mist-metal bg-white px-3 text-base text-graphite"
          >
            <option value="">Текущая смена</option>
            {shifts.map((shift) => (
              <option key={shift.id} value={shift.id}>
                {`Смена ${shift.number} от ${toDateInputValue(shift.date)}`}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-steel-graphite">РЦ</span>
          <select
            name="workCenterId"
            defaultValue={filter.workCenterId ?? ''}
            className="h-10 max-w-[18rem] rounded-md border border-mist-metal bg-white px-3 text-base text-graphite"
          >
            <option value="">Все РЦ</option>
            {/* Выбранное значение, которого на доске больше нет, остаётся в списке:
                молчаливая подмена фильтра — то же, что ложь в интерфейсе. */}
            {filter.workCenterId && filterOptions.missingSelection.workCenter && (
              <option value={filter.workCenterId}>Выбранный РЦ — на доске нет</option>
            )}
            {filterOptions.workCenters.map((workCenter) => (
              <option key={workCenter.id} value={workCenter.id}>
                {workCenter.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-steel-graphite">Номенклатура</span>
          <select
            name="productId"
            defaultValue={filter.productId ?? ''}
            className="h-10 max-w-[18rem] rounded-md border border-mist-metal bg-white px-3 text-base text-graphite"
          >
            <option value="">Вся номенклатура</option>
            {filter.productId && filterOptions.missingSelection.product && (
              <option value={filter.productId}>Выбранная номенклатура — на доске нет</option>
            )}
            {filterOptions.products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          {/* Склад фильтрует только колонки перемещений: у строки РЦ склада нет. */}
          <span className="text-steel-graphite">Склад (для перемещений)</span>
          <select
            name="warehouseId"
            defaultValue={filter.warehouseId ?? ''}
            className="h-10 max-w-[18rem] rounded-md border border-mist-metal bg-white px-3 text-base text-graphite"
          >
            <option value="">Все склады</option>
            {filter.warehouseId && filterOptions.missingSelection.warehouse && (
              <option value={filter.warehouseId}>Выбранный склад — на доске нет</option>
            )}
            {filterOptions.warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          className="h-10 rounded-md border border-transparent bg-deep-industry-blue px-5 text-base font-medium text-white hover:bg-[#0f264f]"
        >
          Показать
        </button>
      </form>

      {(filterOptions.missingSelection.product ||
        filterOptions.missingSelection.workCenter ||
        filterOptions.missingSelection.warehouse) && (
        <p
          role="status"
          className="rounded-md border border-signal-amber/40 bg-signal-amber/10 p-3 text-sm text-graphite"
        >
          Выбранного значения на доске за эту смену нет — фильтр оставлен как есть, чтобы
          не подменять его молча. Снимите его или выберите другую смену.
        </p>
      )}

      {board.otherShiftsWithTransfers > 0 && (
        <p
          role="note"
          className="rounded-md border border-signal-amber/40 bg-signal-amber/10 p-3 text-sm text-graphite"
        >
          За выбранную смену перемещений нет, но они есть за {board.otherShiftsWithTransfers}{' '}
          другую(-их) смену(ы) — выберите смену в фильтре «Смена». Доска показывает только одну
          смену: перемещение относится к смене по дате документа.
        </p>
      )}

      {!board.shift ? (
        <p className="rounded-md border border-mist-metal bg-graphite-surface p-4 text-sm text-steel-graphite">
          В базе нет смен — доске нечего показывать.
        </p>
      ) : cards.length === 0 ? (
        <p className="rounded-md border border-mist-metal bg-graphite-surface p-4 text-sm text-steel-graphite">
          {transferColumnsEmpty
            ? 'За выбранную смену перемещений нет.'
            : 'За выбранную смену строк нет — попробуйте другую смену или снимите фильтры.'}
        </p>
      ) : (
        <KanbanBoard columns={columns} cards={cards} />
      )}
    </main>
  );
}
