import * as React from 'react';

export interface CheckboxListProps {
  name: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

export function CheckboxList({ name, options, selected, onChange }: CheckboxListProps) {
  return (
    <div className="space-y-2">
      {options.map((opt) => {
        const checked = selected.includes(opt.value);
        return (
          <label key={opt.value} className="flex items-center gap-2 text-sm text-neutral-800">
            <input
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
            {opt.label}
          </label>
        );
      })}
    </div>
  );
}
