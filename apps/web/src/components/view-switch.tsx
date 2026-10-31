import Link from 'next/link';

/**
 * Переключатель видов «Список | Канбан» (T-103, решение владельца 30.10.2026).
 *
 * Живёт в шапке и на списке ПЗ, и на доске. Половинка видна только тому, у кого есть право
 * на соответствующий вид: у складских ролей нет `production_order:read`, и ссылка на список
 * вела бы их в отказ доступа. Активная половина — подпись, а не ссылка: переключение
 * «в текущий вид» ничего не делает и только сбивает.
 */
export function ViewSwitch({
  current,
  listHref,
  boardHref,
}: {
  current: 'list' | 'board';
  /** Адрес списка ПЗ или null, если права на список нет. */
  listHref: string | null;
  /** Адрес доски или null, если права на доску нет. */
  boardHref: string | null;
}) {
  if (!listHref && !boardHref) {
    return null;
  }

  const itemClass = 'px-3 py-1.5 text-sm rounded-md';
  const activeClass = 'bg-deep-industry-blue text-white';
  const linkClass = 'text-deep-industry-blue hover:bg-graphite-surface';

  return (
    <nav aria-label="Вид контура" className="inline-flex items-center gap-1 rounded-md border border-mist-metal bg-white p-1">
      {listHref ? (
        current === 'list' ? (
          <span aria-current="page" className={`${itemClass} ${activeClass}`}>
            Список
          </span>
        ) : (
          <Link href={listHref} className={`${itemClass} ${linkClass}`}>
            Список
          </Link>
        )
      ) : null}

      {boardHref ? (
        current === 'board' ? (
          <span aria-current="page" className={`${itemClass} ${activeClass}`}>
            Канбан
          </span>
        ) : (
          <Link href={boardHref} className={`${itemClass} ${linkClass}`}>
            Канбан
          </Link>
        )
      ) : null}
    </nav>
  );
}
