'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { authenticate } from '@/lib/auth/login';
import { createSession } from '@/lib/auth/session';

export interface LoginFormState {
  error: string | null;
}

// TODO T-019: redirect to /change-password when mustChangePassword is true
export async function login(
  _prevState: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const login = formData.get('login')?.toString() ?? '';
  const password = formData.get('password')?.toString() ?? '';

  const requestHeaders = headers();
  const userAgent = requestHeaders.get('user-agent') ?? undefined;
  const ip = requestHeaders.get('x-forwarded-for') ?? requestHeaders.get('x-real-ip') ?? 'unknown';

  const result = await authenticate(login, password, { ip, userAgent });

  if (!result.success) {
    return { error: result.error };
  }

  await createSession(result.userId, userAgent);
  redirect(result.mustChangePassword ? '/change-password' : '/dashboard');
}
