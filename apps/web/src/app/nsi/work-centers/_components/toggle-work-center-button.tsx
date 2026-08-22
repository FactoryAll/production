'use client';

import { useTransition } from 'react';
import { Button } from '@prodtrack/ui';
import { toggleWorkCenterActive } from '../actions';

interface ToggleWorkCenterButtonProps {
  id: string;
  active: boolean;
}

export function ToggleWorkCenterButton({ id, active }: ToggleWorkCenterButtonProps) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          await toggleWorkCenterActive(id);
        });
      }}
    >
      {isPending ? '...' : active ? 'Деактивировать' : 'Активировать'}
    </Button>
  );
}