'use client';

import { useTransition } from 'react';
import { Button } from '@prodtrack/ui';
import { toggleWarehouseActive } from '../actions';

interface ToggleWarehouseButtonProps {
  id: string;
  active: boolean;
}

export function ToggleWarehouseButton({ id, active }: ToggleWarehouseButtonProps) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          await toggleWarehouseActive(id);
        });
      }}
    >
      {isPending ? '...' : active ? 'Деактивировать' : 'Активировать'}
    </Button>
  );
}
