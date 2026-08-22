'use client';

import { useTransition } from 'react';
import { Button } from '@prodtrack/ui';
import { toggleProductActive } from '../actions';

interface ToggleProductButtonProps {
  id: string;
  active: boolean;
}

export function ToggleProductButton({ id, active }: ToggleProductButtonProps) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          await toggleProductActive(id);
        });
      }}
    >
      {isPending ? '...' : active ? 'Деактивировать' : 'Активировать'}
    </Button>
  );
}
