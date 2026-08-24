import * as React from 'react';

export interface DialogProps {
  open?: boolean;
  onClose?: () => void;
  title?: string;
  children?: React.ReactNode;
}

export function Dialog({ open, onClose, title, children }: DialogProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-md border border-mist-metal bg-graphite-surface p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {title ? <h3 className="mb-4 text-lg font-bold text-graphite">{title}</h3> : null}
        {children}
      </div>
    </div>
  );
}
