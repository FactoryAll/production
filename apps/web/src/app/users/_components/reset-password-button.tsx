'use client';

import { useState } from 'react';
import { ResetPasswordDialog } from './reset-password-dialog';

interface ResetPasswordButtonProps {
  userId: string;
  login: string;
}

/** Действие «Сбросить пароль» в списке пользователей — там, где его ищут при обращении пользователя. */
export function ResetPasswordButton({ userId, login }: ResetPasswordButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-deep-industry-blue hover:underline"
      >
        Сбросить пароль
      </button>
      <ResetPasswordDialog
        // Диалог смонтирован постоянно: состояние сбрасывается сменой ключа (урок Фазы 6).
        key={open ? 'reset-open' : 'reset-closed'}
        open={open}
        onClose={() => setOpen(false)}
        userId={userId}
        login={login}
      />
    </>
  );
}
