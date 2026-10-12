'use client';

import * as React from 'react';

export interface SearchSelectOption {
  value: string;
  label: string;
  /** Дополнительный текст для поиска: артикул, единица измерения, синонимы. */
  keywords?: string;
}

export interface SearchSelectProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: SearchSelectOption[];
  placeholder?: string;
  /** Текст, когда по запросу ничего не найдено. */
  emptyText?: string;
  /** Сколько вариантов показывать: длинный список не должен закрывать весь экран. */
  maxVisible?: number;
  disabled?: boolean;
  required?: boolean;
  className?: string;
}

export const SEARCH_SELECT_DEFAULT_MAX_VISIBLE = 50;

/** Сравнение не зависит от регистра, «ё» и лишних пробелов: ищут и по коду, и по наименованию. */
export function normalizeSearchText(text: string): string {
  return text.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

/**
 * Выбор из длинного списка с поиском.
 *
 * Обычный `<select>` не годится, когда позиций сотни: после загрузки номенклатуры из файла
 * (T-077) в списках стало по несколько сотен строк, и найти нужную прокруткой невозможно.
 * Здесь поле ввода фильтрует варианты по коду и наименованию, работают стрелки, Enter и Escape.
 */
export function SearchSelect({
  id,
  value,
  onChange,
  options,
  placeholder = 'Начните вводить код или наименование',
  emptyText = 'Ничего не найдено',
  maxVisible = SEARCH_SELECT_DEFAULT_MAX_VISIBLE,
  disabled = false,
  required = false,
  className = '',
}: SearchSelectProps) {
  const listId = React.useId();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [query, setQuery] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [highlight, setHighlight] = React.useState(0);

  const selected = React.useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  );

  const matches = React.useMemo(() => {
    const needle = normalizeSearchText(query);
    if (!needle) {
      return options;
    }
    const words = needle.split(' ');
    return options.filter((option) => {
      const haystack = normalizeSearchText(option.label + ' ' + (option.keywords ?? ''));
      return words.every((word) => haystack.includes(word));
    });
  }, [options, query]);

  const visible = React.useMemo(() => matches.slice(0, maxVisible), [matches, maxVisible]);

  function openList() {
    if (disabled) {
      return;
    }
    setQuery('');
    setHighlight(Math.max(0, visible.findIndex((option) => option.value === value)));
    setOpen(true);
  }

  function closeList() {
    setOpen(false);
    setQuery('');
  }

  function select(option: SearchSelectOption) {
    onChange(option.value);
    closeList();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        openList();
        return;
      }
      setHighlight((prev) =>
        event.key === 'ArrowDown' ? Math.min(prev + 1, visible.length - 1) : Math.max(prev - 1, 0),
      );
      return;
    }

    if (event.key === 'Enter') {
      const option = visible[highlight];
      if (open && option) {
        event.preventDefault();
        select(option);
      }
      return;
    }

    if (event.key === 'Escape') {
      closeList();
      return;
    }

    if (event.key === 'Tab') {
      closeList();
    }
  }

  React.useEffect(() => {
    if (!open) {
      return;
    }
    function handlePointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        closeList();
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  // Пока список открыт, в поле — то, что печатает пользователь; когда закрыт — выбранное значение.
  const displayValue = open ? query : (selected?.label ?? '');

  return (
    <div ref={rootRef} className={'relative ' + className}>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && visible[highlight] ? listId + '-' + highlight : undefined}
          autoComplete="off"
          value={displayValue}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          onFocus={openList}
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlight(0);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-deep-industry-blue disabled:bg-neutral-100"
        />
        {selected && !disabled && (
          <button
            type="button"
            aria-label="Очистить выбор"
            onClick={() => {
              onChange('');
              closeList();
            }}
            className="rounded-md border border-neutral-300 px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-50"
          >
            ×
          </button>
        )}
      </div>

      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-neutral-300 bg-white py-1 text-sm shadow-lg"
        >
          {visible.length === 0 && <li className="px-3 py-2 text-neutral-500">{emptyText}</li>}
          {visible.map((option, index) => (
            <li
              key={option.value}
              id={listId + '-' + index}
              role="option"
              aria-selected={option.value === value}
              onMouseDown={(event) => {
                event.preventDefault();
                select(option);
              }}
              onMouseEnter={() => setHighlight(index)}
              className={
                'cursor-pointer px-3 py-2 ' + (index === highlight ? 'bg-graphite-surface' : '')
              }
            >
              {option.label}
            </li>
          ))}
          {matches.length > visible.length && (
            <li className="px-3 py-2 text-xs text-neutral-500">
              {'Показаны первые ' + visible.length + ' из ' + matches.length + ' — уточните запрос'}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
