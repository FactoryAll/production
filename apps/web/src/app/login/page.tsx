import { login } from './actions';
import { Button, Input } from '@prodtrack/ui';

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-graphite-surface">
      <form action={login} className="w-full max-w-md space-y-4 rounded-md border border-mist-metal bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-graphite">Вход в ProdTrack</h1>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-graphite">Логин</span>
          <Input name="login" required autoFocus />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-graphite">Пароль</span>
          <Input type="password" name="password" required />
        </label>
        <Button type="submit" className="w-full">Войти</Button>
      </form>
    </main>
  );
}
