'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog, Input } from '@prodtrack/ui';
import { changePasswordAction } from '@/app/change-password/actions';

interface ChangeOwnPasswordDialogProps {
  open: boolean;
  onClose: () => void;
  login: string;
}

/**
 * Смена своего пароля из списка пользователей (12.11.2026).
 *
 * Зачем здесь, а не только на /change-password: администратор ищет действие с паролем в строке
 * своего пользователя, и раньше получал отказ «смените на экране «Смена пароля»» — при том что
 * входа на тот экран в интерфейсе не было вовсе.
 *
 * Логика НЕ дублируется: вызывается тот же `changePasswordAction`, что и со страницы смены
 * пароля. Он требует текущий пароль, проверяет новый по политике, меняет хеш, снимает
 * `mustChangePassword` и пишет аудит — и **не завершает сессии**: администратор остаётся в системе.
 * Правило живёт в одном месте, а точек входа может быть несколько.
 */
export function ChangeOwnPasswordDialog({ open, onClose, login }: ChangeOwnPasswordDialogProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const formData = new FormData(event.currentTarget);
    const newPassword = formData.get('newPassword')?.toString() ?? '';
    const confirmPassword = formData.get('confirmPassword')?.toString() ?? '';
    if (confirmPassword !== '' && newPassword !== confirmPassword) {
      setError('Пароли не совпадают');
      return;
    }

    setPending(true);
    const result = await changePasswordAction(formData);
    setPending(false);

    if (result.success) {
      setDone(true);
      // Список не перечитываем: пароль в таблице не показывается, а обновление страницы
      // закрыло бы диалог с подтверждением.
      router.refresh();
      return;
    }
    setError(result.error ?? 'Не удалось сменить пароль');
  }

  return (
    <Dialog open={open} onClose={onClose} title="Смена своего пароля">
      {done ? (
        <div className="space-y-4">
          <p className="text-sm text-graphite">
            Пароль для <span className="font-medium">{login}</span> изменён. Открытые сессии не
            завершены — вы остаётесь в системе, как и задумано для смены своего пароля.
          </p>
          <div className="flex justify-end">
            <Button type="button" onClick={onClose}>
              Готово
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-graphite">
            Это ваша учётная запись. Введите текущий пароль и новый — сессии при этом не
            завершаются.
          </p>

          <label className="flex flex-col gap-1 text-sm" htmlFor="own-current-password">
            <span className="text-steel-graphite">Текущий пароль</span>
            <Input
              id="own-current-password"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>

          <label className="flex flex-col gap-1 text-sm" htmlFor="own-new-password">
            <span className="text-steel-graphite">Новый пароль</span>
            <Input id="own-new-password" name="newPassword" type="password" autoComplete="new-password" required />
          </label>

          <label className="flex flex-col gap-1 text-sm" htmlFor="own-confirm-password">
            <span className="text-steel-graphite">Повторите новый пароль</span>
            <Input
              id="own-confirm-password"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
            />
          </label>

          {error && <p className="text-sm text-signal-amber">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
              Отмена
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Меняем…' : 'Сменить пароль'}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
