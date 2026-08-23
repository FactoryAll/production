'use client';

import { Button, Dialog } from '@prodtrack/ui';

export interface DeactivationDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  entityName?: string;
  warnings: { id: string; label: string }[];
  isPending?: boolean;
}

export function DeactivationDialog({
  open,
  onClose,
  onConfirm,
  title = 'Деактивировать позицию?',
  entityName = 'позиция',
  warnings,
  isPending = false,
}: DeactivationDialogProps) {
  const hasWarnings = warnings.length > 0;

  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        <p className="text-base text-graphite">
          {hasWarnings ? (
            <>
              Эта {entityName} используется в {warnings.length} незавершённых документах. После деактивации
              она останется в документах с пометкой «(неактивно)», но будет недоступна для выбора в новых
              документах.
            </>
          ) : (
            <>
              Деактивированная {entityName} останется в незавершённых и исторических документах с пометкой
              «(неактивно)», но будет недоступна для выбора в новых документах.
            </>
          )}
        </p>
        {hasWarnings && (
          <div className="rounded-md bg-graphite-surface p-3">
            <p className="mb-2 text-sm font-medium text-graphite">Незавершённые документы:</p>
            <ul className="list-inside list-disc space-y-1 text-sm text-graphite">
              {warnings.map((warning) => (
                <li key={warning.id}>{warning.label}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            Отмена
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={isPending}>
            {isPending ? 'Сохранение...' : 'Деактивировать'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
