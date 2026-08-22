import * as React from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', ...props }, ref) => (
    <input
      ref={ref}
      className={`flex h-[var(--button-height-sm)] w-full rounded-md border border-mist-metal bg-white px-3 py-2 text-base text-graphite placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-deep-industry-blue ${className}`}
      {...props}
    />
  )
);
Input.displayName = 'Input';
