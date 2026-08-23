import bcrypt from 'bcryptjs';

export const SALT_ROUNDS = 10;

export function isPasswordValid(password: string): boolean {
  if (password.length < 8) return false;
  if (!/[a-zA-Zа-яА-Я]/.test(password)) return false;
  if (!/[0-9]/.test(password)) return false;
  return true;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}