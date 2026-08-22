'use client';

import { useTransition } from 'react';
import { Button } from '@prodtrack/ui';
import { toggleSubstitutionReasonActive } from '../actions';

interface ToggleSubstitutionReasonButtonProps {
  id: string;
  active: boolean;
}

export function ToggleSubstitutionReasonButton({ id, active }: ToggleSubstitutionReasonButtonProps) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          await toggleSubstitutionReasonActive(id);
        });
      }}
    >
      {isPending ? '...' : active ? 'Деактивировать' : 'Активировать'}
    </Button>
  );
}
