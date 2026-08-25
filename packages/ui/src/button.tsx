import * as React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'cta';
  size?: 'sm' | 'md';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className = '', children, ...props }, ref) => {
    const base =
      'inline-flex items-center justify-center rounded-[6px] font-sans font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none';
    const variants = {
      primary:
        'bg-deep-industry-blue text-white hover:bg-[#0f264f] border border-transparent',
      secondary:
        'bg-graphite-surface text-graphite hover:bg-[#e5ebf1] border border-mist-metal',
      danger: 'bg-red-600 text-white hover:bg-red-700 border border-transparent',
      cta: 'bg-signal-amber text-graphite hover:bg-[#b07b25] border border-transparent'
    };
    const sizes = {
      sm: 'h-12 px-5 py-3 text-base',
      md: 'h-14 px-7 py-3 text-base'
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