'use client';

import { useState } from 'react';
import { Button, Dialog } from '@prodtrack/ui';
import { resetPasswordAction } from '../actions';
import { TempPasswordNotice } from './temp-password-notice';

interface ResetPasswordDialogProps {
  open: boolean;
  onClose: () => void;
  userId: string;
  login: string;
}

/**
 * Сброс пароля (Р-15): администратор выдаёт временный пароль, пользователь меняет его при входе.
 * Подтверждение обязательно — сброс завершает открытые сессии пользователя.
 */
export function ResetPasswordDialog({ open, onClose, userId, login }: ResetPasswordDialogProps) {
  const [pending, setPending] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleReset() {
    setPending(true);
    setError(null);

    const result = await resetPasswordAction(userId);
    setPending(false);

    if (result.success && result.tempPassword) {
      // Обновлять список не нужно: сброс пароля не меняет данные пользователя в таблице,
      // а лишнее обновление страницы закрывало бы диалог с показанным паролем.
      setTempPassword(result.tempPassword);
      return;
    }
    setError(result.error ?? 'Не удалось сбросить пароль');
  }

  return (
    <Dialog open={open} onClose={onClose} title="Сброс пароля">
      {tempPassword ? (
        <div className="space-y-4">
          <TempPasswordNotice password={tempPassword} login={login} />
          <div className="flex justify-end">
            <Button type="button" onClick={onClose}>
              Готово
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-graphite">
            Пользователь <span className="font-medium">{login}</span> получит временный пароль, а его
            открытые сессии завершатся. Пароль показывается один раз — сохраните его до передачи
            пользователю.
          </p>
          {error && <p className="text-sm text-signal-amber">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
              Отмена
            </Button>
            <Button type="button" onClick={handleReset} disabled={pending}>
              {pending ? 'Сброс...' : 'Сбросить пароль'}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
