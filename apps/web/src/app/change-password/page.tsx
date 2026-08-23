'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@prodtrack/ui';
import { changePasswordAction } from './actions';
import { validatePassword } from '@/lib/auth/password-validation';

export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const validate = useCallback(() => {
    const result = validatePassword(newPassword);
    const nextErrors = [...result.errors];
    if (confirmPassword && newPassword !== confirmPassword) {
      nextErrors.push('Пароли не совпадают');
    }
    setErrors(nextErrors);
    return nextErrors.length === 0;
  }, [newPassword, confirmPassword]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerError(null);
    if (!validate()) return;

    setIsPending(true);
    const formData = new FormData();
    formData.set('currentPassword', currentPassword);
    formData.set('newPassword', newPassword);
    formData.set('confirmPassword', confirmPassword);

    try {
      const result = await changePasswordAction(formData);
      if (result.error) {
        setServerError(result.error);
      } else if (result.success) {
        setSuccess(true);
        setTimeout(() => router.push('/dashboard'), 1500);
      }
    } finally {
      setIsPending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-graphite-surface px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md space-y-4 rounded-md border border-mist-metal bg-white p-6 shadow-sm"
      >
        <h1 className="text-2xl font-bold text-graphite">Смена пароля</h1>
        <p className="text-sm text-neutral-600">
          Минимум 8 символов, буквы и цифры. После успешной смены пароля вы будете перенаправлены на дашборд.
        </p>

        <div className="space-y-1">
          <label htmlFor="currentPassword" className="text-sm font-medium text-graphite">Текущий пароль</label>
          <Input
            id="currentPassword"
            type="password"
            name="currentPassword"
            value={currentPassword}
            onChange={(e) => {
              setCurrentPassword(e.target.value);
              setServerError(null);
            }}
            required
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="newPassword" className="text-sm font-medium text-graphite">Новый пароль</label>
          <Input
            id="newPassword"
            type="password"
            name="newPassword"
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value);
              setServerError(null);
              setErrors([]);
            }}
            onBlur={() => validate()}
            required
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="confirmPassword" className="text-sm font-medium text-graphite">Подтверждение пароля</label>
          <Input
            id="confirmPassword"
            type="password"
            name="confirmPassword"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              setServerError(null);
              setErrors([]);
            }}
            onBlur={() => validate()}
            required
          />
        </div>

        {errors.length > 0 && (
          <ul className="space-y-1 text-sm text-red-600">
            {errors.map((error, index) => (
              <li key={index}>{error}</li>
            ))}
          </ul>
        )}

        {serverError && <p className="text-sm text-red-600">{serverError}</p>}
        {success && <p className="text-sm text-green-600">Пароль успешно изменён</p>}

        <Button
          type="submit"
          variant="primary"
          className="w-full"
          disabled={isPending || errors.length > 0}
        >
          {isPending ? 'Сохранение...' : 'Сменить пароль'}
        </Button>
      </form>
    </main>
  );
}
