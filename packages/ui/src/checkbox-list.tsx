import * as React from 'react';

export interface CheckboxListProps {
  name: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

/**
 * Список чекбоксов с подписями.
 *
 * Раскладка важна, а не только разметка: `label` блочного уровня растягивается на всю
 * ширину строки, а браузер переключает связанный чекбокс по клику в ЛЮБОЙ точке label.
 * Пока весь ряд был одним `label`, клик по пустому месту справа от фамилии отмечал
 * сотрудника — на форме ПЗ это привело к случайным отметкам (замер: 1582 px ширины
 * label при 16 px самого чекбокса, 1558 px мёртвой зоны).
 *
 * Поэтому ряд — `div`, а `label` относится только к фамилии: кликабельны сам чекбокс
 * и текст, пустое место строки — нет.
 */
export function CheckboxList({ name, options, selected, onChange }: CheckboxListProps) {
  return (
    <div className="space-y-2">
      {options.map((opt) => {
        const checked = selected.includes(opt.value);
        const id = `${name}-${opt.value}`;
        return (
          <div key={opt.value} className="flex w-fit items-center gap-2 text-sm text-neutral-800">
            <input
              id={id}
              type="checkbox"
              name={name}
              value={opt.value}
              checked={checked}
              onChange={() => {
                const next = checked
                  ? selected.filter((v) => v !== opt.value)
                  : [...selected, opt.value];
                onChange(next);
              }}
              className="h-4 w-4 rounded border-neutral-300 text-deep-industry-blue focus:ring-deep-industry-blue"
            />
            <label htmlFor={id} className="cursor-pointer">
              {opt.label}
            </label>
          </div>
        );
      })}
    </div>
  );
}
