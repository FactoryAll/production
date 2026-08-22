'use client';

import { useTransition } from 'react';
import { Button } from '@prodtrack/ui';
import { toggleEmployeeActive } from '../actions';

interface ToggleEmployeeButtonProps {
  id: string;
  active: boolean;
}

export function ToggleEmployeeButton({ id, active }: ToggleEmployeeButtonProps) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          await toggleEmployeeActive(id);
        });
      }}
    >
      {isPending ? '...' : active ? 'Деактивировать' : 'Активировать'}
    </Button>
  );
}
