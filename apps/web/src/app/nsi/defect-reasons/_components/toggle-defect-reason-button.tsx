'use client';

import { useTransition } from 'react';
import { Button } from '@prodtrack/ui';
import { toggleDefectReasonActive } from '../actions';

interface ToggleDefectReasonButtonProps {
  id: string;
  active: boolean;
}

export function ToggleDefectReasonButton({ id, active }: ToggleDefectReasonButtonProps) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          await toggleDefectReasonActive(id);
        });
      }}
    >
      {isPending ? '...' : active ? 'Деактивировать' : 'Активировать'}
    </Button>
  );
}
