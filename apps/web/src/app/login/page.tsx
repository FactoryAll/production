import { Suspense } from 'react';
import { LoginForm } from './_components/login-form';

function ErrorMessage({ error }: { error: string }) {
  return (
    <div className="mb-4 rounded-md bg-signal-amber/10 p-3 text-sm text-graphite" role="alert">
      {error}
    </div>
  );
}

function SearchParamsError() {
  const searchParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const error = searchParams.get('error');

  if (error === 'outside_shift_window') {
    return <ErrorMessage error="Вне рабочего времени. Операторы могут входить за 1 час до начала смены и выходить через 1 час после окончания." />;
  }

  return null;
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-graphite-surface px-4">
      <Suspense fallback={null}>
        <SearchParamsError />
      </Suspense>
      <LoginForm />
    </main>
  );
}
