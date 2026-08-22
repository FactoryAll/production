'use client';

import { useTransition } from 'react';
import { Button } from '@prodtrack/ui';
import { toggleShiftActive } from '../actions';

interface ToggleShiftButtonProps {
  id: string;
  active: boolean;
}

export function ToggleShiftButton({ id, active }: ToggleShiftButtonProps) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          await toggleShiftActive(id);
        });
      }}
    >
      {isPending ? '...' : active ? 'Деактивировать' : 'Активировать'}
    </Button>
  );
}
