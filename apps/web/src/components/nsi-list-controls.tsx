// Общий блок поиска и фильтра активности для списков НСИ (M01 §8, T-058).
//
// Фильтрация выполняется на сервере, поэтому форма отправляет GET-запрос
// с параметрами `q` и `active`.

import { Button, Input } from '@prodtrack/ui';

export type NsiActiveFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';

export interface NsiListControlsProps {
  /** Адрес списка, куда уходит GET-запрос. */
  action: string;
  /** Текущий поисковый запрос. */
  query: string;
  /** Текущий фильтр активности. */
  activeFilter: NsiActiveFilter;
  placeholder: string;
}

export function NsiListControls({
  action,
  query,
  activeFilter,
  placeholder,
}: NsiListControlsProps) {
  return (
    <form method="get" action={action} className="flex flex-col gap-4 sm:flex-row">
      <Input name="q" defaultValue={query} placeholder={placeholder} className="max-w-sm" />
      <select
        name="active"
        defaultValue={activeFilter}
        className="h-[var(--button-height-sm)] rounded-md border border-mist-metal bg-white px-3 font-sans text-graphite"
      >
        <option value="ALL">Все</option>
        <option value="ACTIVE">Активные</option>
        <option value="INACTIVE">Неактивные</option>
      </select>
      <Button type="submit" variant="secondary">
        Найти
      </Button>
    </form>
  );
}

/** Подпись пустого результата с учётом активных условий фильтрации. */
export function emptyListLabel(query: string, activeFilter: NsiActiveFilter): string {
  return query || activeFilter !== 'ALL'
    ? 'По заданным условиям ничего не найдено.'
    : 'Список пуст.';
}
