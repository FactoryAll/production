'use client';

import { useFormState } from 'react-dom';
import { Button, Input } from '@prodtrack/ui';
import { login, type LoginFormState } from '../actions';

export function LoginForm() {
  const [state, formAction] = useFormState<LoginFormState, FormData>(login, { error: null });

  return (
    <form action={formAction} className="w-full max-w-md space-y-4 rounded-md border border-mist-metal bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-bold text-graphite">Вход в ProdTrack</h1>
      <label className="block space-y-1">
        <span className="text-sm font-medium text-graphite">Логин</span>
        <Input name="login" required autoFocus />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium text-graphite">Пароль</span>
        <Input type="password" name="password" required />
      </label>
      {state.error && (
        <p className="rounded-md bg-signal-amber/10 p-3 text-sm text-graphite" role="alert">
          {state.error}
        </p>
      )}
      <Button type="submit" variant="cta" size="md" className="w-full">
        Войти
      </Button>
    </form>
  );
}
