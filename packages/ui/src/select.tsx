import * as React from 'react';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string }[];
  placeholder?: string;
  error?: string;
}

export function Select({ options, placeholder, error, className = '', ...props }: SelectProps) {
  return (
    <div className={className}>
      <select
        className={`w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-deep-industry-blue ${error ? 'border-red-500' : ''}`.trim()}
        {...props}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}
