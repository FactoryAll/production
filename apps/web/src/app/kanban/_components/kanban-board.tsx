import Link from 'next/link';
import type { KanbanCard } from '@/lib/kanban/board';
import type { KanbanColumn } from '@/lib/kanban/stage';

/**
 * Тон метки на карточке (ОПЭ-74). Цвет — из токенов темы (`--color-signal-rose` /
 * `--color-signal-mint`), а сам тон приходит из данных (`card.noteTone`), а не выводится
 * из текста метки в разметке.
 */
const NOTE_TONE_CLASS: Record<KanbanCard['noteTone'], string> = {
  pending: 'bg-signal-rose',
  done: 'bg-signal-mint',
  neutral: 'bg-neutral-200',
};

/**
 * Доска контура: колонки и карточки (T-103, постановка `docs/kanban_design.md` §13).
 *
 * Компонент чистый — получает готовые колонки и карточки, ничего не запрашивает. Так его можно
 * проверить без базы, а сборку данных оставить `lib/kanban/board.ts`.
 *
 * Доска **ничего не меняет**: карточка — ссылка на экран действия, перетаскивания нет
 * (решение владельца: за этапами стоят действия с правами и подтверждениями).
 */
export function KanbanBoard({
  columns,
  cards,
  emptyColumnLabel = '—',
}: {
  columns: KanbanColumn[];
  cards: KanbanCard[];
  /** Что показывать в пустой колонке: пустое место читается как «не загрузилось». */
  emptyColumnLabel?: string;
}) {
  const byColumn = new Map<string, KanbanCard[]>();
  for (const card of cards) {
    const list = byColumn.get(card.column) ?? [];
    list.push(card);
    byColumn.set(card.column, list);
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {columns.map((column) => {
        const columnCards = byColumn.get(column.key) ?? [];
        return (
          <section
            key={column.key}
            aria-label={column.title}
            className="flex w-64 min-w-[16rem] flex-col gap-2 rounded-md border border-mist-metal bg-graphite-surface p-2"
          >
            <header className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-bold text-graphite">{column.title}</h2>
              {/* Число карточек в заголовке: по нему видно, где затор, не считая глазами. */}
              <span className="text-xs text-machine-gray">{columnCards.length}</span>
            </header>

            {columnCards.length === 0 ? (
              <p className="px-1 py-2 text-xs text-machine-gray">{emptyColumnLabel}</p>
            ) : (
              <ul className="space-y-2">
                {columnCards.map((card) => (
                  <li key={card.lineId}>
                    <Link
                      href={card.href}
                      className="block rounded-md border border-mist-metal bg-white p-2 text-sm hover:bg-neutral-100"
                    >
                      <p className="font-medium text-graphite">
                        {card.orderLabel}
                        <span className="font-normal text-steel-graphite"> · {card.shiftLabel}</span>
                      </p>
                      <p className="text-graphite">
                        РЦ {card.workCenterCode} — {card.workCenterName}
                      </p>
                      <p className="text-steel-graphite">
                        {card.productCode} — {card.productName}
                      </p>
                      <p className="text-steel-graphite">
                        План {card.plan} {card.productUnit}
                        {card.fact > 0 ? ` · факт ${card.fact} ${card.productUnit}` : ''}
                      </p>
                      {card.operatorName && (
                        <p className="text-steel-graphite">Оператор: {card.operatorName}</p>
                      )}
                      {card.note && (
                        <p
                          className={`mt-1 inline-flex rounded px-2 py-0.5 text-xs text-graphite ${NOTE_TONE_CLASS[card.noteTone]}`}
                        >
                          {card.note}
                        </p>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
