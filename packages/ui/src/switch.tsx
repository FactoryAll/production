import * as React from 'react';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}

export function Switch({ checked, onChange, label }: SwitchProps) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-3">
      <span className="relative inline-flex h-6 w-11 items-center rounded-full bg-neutral-300 transition-colors data-[checked=true]:bg-deep-industry-blue" data-checked={checked}>
        <input
          type="checkbox"
          className="sr-only"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`}
        />
      </span>
      {label && <span className="text-sm font-medium text-neutral-700">{label}</span>}
    </label>
  );
}
