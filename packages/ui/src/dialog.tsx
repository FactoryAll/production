import * as React from 'react';

export type DialogSize = 'md' | 'lg';

export interface DialogProps {
  open?: boolean;
  onClose?: () => void;
  title?: string;
  /** Ширина окна: 'md' — обычная форма, 'lg' — окна с таблицами и отчётами. */
  size?: DialogSize;
  children?: React.ReactNode;
}

const SIZE_CLASSES: Record<DialogSize, string> = {
  md: 'max-w-md',
  lg: 'max-w-3xl',
};

export function Dialog({ open, onClose, title, size = 'md', children }: DialogProps) {
  return (
    <>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
          <div
            role="dialog"
            aria-modal="true"
            className={`w-full ${SIZE_CLASSES[size]} max-h-[85vh] overflow-y-auto rounded-md border border-mist-metal bg-graphite-surface p-6 shadow-lg`}
            onClick={(e) => e.stopPropagation()}
          >
            {title ? <h3 className="mb-4 text-lg font-bold text-graphite">{title}</h3> : null}
            {children}
          </div>
        </div>
      )}
    </>
  );
}
