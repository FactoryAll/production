import * as React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className = '', children, ...props }, ref) => (
    <div
      ref={ref}
      className={`rounded-md border border-mist-metal bg-graphite-surface p-6 shadow-sm ${className}`}
      {...props}
    >
      {children}
    </div>
  )
);
Card.displayName = 'Card';

export interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}
export const CardHeader = React.forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ className = '', ...props }, ref) => (
    <div ref={ref} className={`mb-4 ${className}`} {...props} />
  )
);
CardHeader.displayName = 'CardHeader';

export interface CardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {}
export const CardTitle = React.forwardRef<HTMLHeadingElement, CardTitleProps>(
  ({ className = '', ...props }, ref) => (
    <h3 ref={ref} className={`text-lg font-bold text-graphite ${className}`} {...props} />
  )
);
CardTitle.displayName = 'CardTitle';

export interface CardContentProps extends React.HTMLAttributes<HTMLDivElement> {}
export const CardContent = React.forwardRef<HTMLDivElement, CardContentProps>(
  ({ className = '', ...props }, ref) => <div ref={ref} className={className} {...props} />
);
CardContent.displayName = 'CardContent';
