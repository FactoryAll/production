'use client';

import { useState, useTransition } from 'react';
import { Button } from '@prodtrack/ui';
import { getDeactivationWarnings, toggleShiftActive } from '../actions';
import { DeactivationDialog } from '@/components/deactivation-dialog';

interface ToggleShiftButtonProps {
  id: string;
  active: boolean;
}

export function ToggleShiftButton({ id, active }: ToggleShiftButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [warnings, setWarnings] = useState<{ id: string; label: string }[]>([]);

  async function requestToggle() {
    if (active) {
      const fetched = await getDeactivationWarnings(id);
      setWarnings(fetched);
      setConfirmOpen(true);
    } else {
      handleToggle();
    }
  }

  function handleToggle() {
    startTransition(async () => {
      await toggleShiftActive(id);
      setConfirmOpen(false);
      setWarnings([]);
    });
  }

  return (
    <>
      <Button variant="secondary" size="sm" disabled={isPending} onClick={requestToggle}>
        {isPending ? '...' : active ? 'Деактивировать' : 'Активировать'}
      </Button>

      <DeactivationDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleToggle}
        title="Деактивировать смену?"
        entityName="смена"
        warnings={warnings}
        isPending={isPending}
      />
    </>
  );
}
