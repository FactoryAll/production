'use server';

import { revalidatePath } from 'next/cache';
import { prisma, writeAudit } from '@prodtrack/db';
import { getPrimaryRole } from '@prodtrack/contracts';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { validatePassword } from '@/lib/auth/password-validation';
import { requireSession } from '@/lib/auth/session';

export interface ChangePasswordResult {
  success?: boolean;
  error?: string;
}

export async function changePasswordAction(formData: FormData): Promise<ChangePasswordResult> {
  const session = await requireSession();
  const { userId, user } = session;

  const currentPassword = formData.get('currentPassword')?.toString() ?? '';
  const newPassword = formData.get('newPassword')?.toString() ?? '';
  const confirmPassword = formData.get('confirmPassword')?.toString() ?? '';

  if (newPassword !== confirmPassword) {
    return { error: 'Пароли не совпадают' };
  }

  const validation = validatePassword(newPassword);
  if (!validation.valid) {
    return { error: validation.errors.join(', ') };
  }

  const isValid = await verifyPassword(currentPassword, user.passwordHash);
  if (!isValid) {
    return { error: 'Неверный текущий пароль' };
  }

  const newPasswordHash = await hashPassword(newPassword);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        passwordHash: newPasswordHash,
        mustChangePassword: false,
      },
    });

    await writeAudit(tx, {
      action: 'UPDATE',
      objectType: 'User',
      objectId: userId,
      field: 'passwordHash',
      oldValue: '[REDACTED]',
      newValue: '[CHANGED]',
      userId,
      role: getPrimaryRole(user.roles.map((ur) => ur.role.code)) ?? undefined,
    });
  });

  revalidatePath('/');
  return { success: true };
}
