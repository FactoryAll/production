import * as React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'cta';
  size?: 'sm' | 'md';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className = '', children, ...props }, ref) => {
    const base =
      'inline-flex items-center justify-center rounded-md font-sans font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none';
    const variants = {
      primary:
        'bg-deep-industry-blue text-white hover:bg-neutral-700 border border-transparent',
      secondary:
        'bg-graphite-surface text-graphite hover:bg-neutral-200 border border-mist-metal',
      danger: 'bg-signal-amber text-graphite hover:bg-neutral-400 border border-transparent',
      cta: 'bg-signal-amber text-graphite hover:bg-signal-amber/90 border border-transparent'
    };
    const sizes = {
      sm: 'h-[var(--button-height-sm)] px-4 text-base',
      md: 'h-[var(--button-height-md)] px-6 text-base'
    };
    const classes = [base, variants[variant], sizes[size], className].join(' ');
    return (
      <button ref={ref} className={classes} {...props}>
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';