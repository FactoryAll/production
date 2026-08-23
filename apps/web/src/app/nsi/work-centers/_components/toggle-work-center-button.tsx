'use client';

import { useState, useTransition } from 'react';
import { Button } from '@prodtrack/ui';
import { getDeactivationWarnings, toggleWorkCenterActive } from '../actions';
import { DeactivationDialog } from '@/components/deactivation-dialog';

interface ToggleWorkCenterButtonProps {
  id: string;
  active: boolean;
}

export function ToggleWorkCenterButton({ id, active }: ToggleWorkCenterButtonProps) {
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
      await toggleWorkCenterActive(id);
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
        title="Деактивировать производственный центр?"
        entityName="производственный центр"
        warnings={warnings}
        isPending={isPending}
      />
    </>
  );
}
