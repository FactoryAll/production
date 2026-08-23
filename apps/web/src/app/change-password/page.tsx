// TODO T-019: реализовать политику паролей и смену passwordHash в БД

import { redirect } from 'next/navigation';

async function changePassword(formData: FormData) {
  'use server';
  const newPassword = formData.get('newPassword')?.toString() ?? '';
  if (newPassword.length < 8) return;
  // TODO T-019: проверить текущий пароль, обновить хеш и снять mustChangePassword
  redirect('/');
}

export default function ChangePasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-graphite-surface px-4">
      <form action={changePassword} className="w-full max-w-md space-y-4 rounded-md border border-mist-metal bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-graphite">Смена пароля</h1>
        <p className="text-sm text-neutral-600">Минимум 8 символов.</p>
        <button type="submit" className="w-full rounded-md bg-deep-industry-blue px-4 py-2 text-white">
          Сохранить
        </button>
      </form>
    </main>
  );
}
