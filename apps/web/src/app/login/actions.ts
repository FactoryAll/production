'use server';

import { createSession } from '@/lib/auth/session';
import { redirect } from 'next/navigation';

// Skeleton: in production this validates the user against the DB.
const ADMIN_LOGIN = process.env.ADMIN_LOGIN || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const ADMIN_USER_ID = process.env.ADMIN_USER_ID || 'admin-user';

export async function login(formData: FormData): Promise<void> {
  const login = formData.get('login')?.toString() ?? '';
  const password = formData.get('password')?.toString() ?? '';

  if (login !== ADMIN_LOGIN || password !== ADMIN_PASSWORD) {
    throw new Error('Invalid credentials');
  }

  await createSession(ADMIN_USER_ID);
  redirect('/');
}
