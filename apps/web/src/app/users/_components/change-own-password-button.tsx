'use client';

import { useState } from 'react';
import { ChangeOwnPasswordDialog } from './change-own-password-dialog';

interface ChangeOwnPasswordButtonProps {
  login: string;
}

/**
 * Действие «Сменить свой пароль» в своей строке списка пользователей (12.11.2026).
 *
 * Почему не «Сбросить пароль»: сброс своего пароля намеренно запрещён — он завершает открытые
 * сессии и выбросил бы администратора из системы. Раньше на этом месте был отказ со словами
 * «смените на экране «Смена пароля»», но входа на тот экран в интерфейсе не было. Теперь здесь
 * своя форма: она требует текущий пароль и НЕ завершает сессии.
 */
export function ChangeOwnPasswordButton({ login }: ChangeOwnPasswordButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-deep-industry-blue hover:underline"
      >
        Сменить свой пароль
      </button>
      <ChangeOwnPasswordDialog
        key={open ? 'own-open' : 'own-closed'}
        open={open}
        onClose={() => setOpen(false)}
        login={login}
      />
    </>
  );
}
