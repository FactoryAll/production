import { describe, it, expect } from 'vitest';
import { validatePassword } from './password-validation';

describe('validatePassword', () => {
  it('rejects passwords shorter than 8 characters', () => {
    const result = validatePassword('A1');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Пароль должен содержать не менее 8 символов');
  });

  it('rejects passwords without letters', () => {
    const result = validatePassword('12345678');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Пароль должен содержать буквы');
  });

  it('rejects passwords without digits', () => {
    const result = validatePassword('abcdefgh');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Пароль должен содержать цифры');
  });

  it('accepts valid password with latin letters and digits', () => {
    const result = validatePassword('Password1');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts valid password with cyrillic letters and digits', () => {
    const result = validatePassword('Пароль123');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects password missing both letters and digits', () => {
    const result = validatePassword('!@#$%^*');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Пароль должен содержать буквы');
    expect(result.errors).toContain('Пароль должен содержать цифры');
  });
});
