import { describe, it, expect } from 'vitest';
import { TEMP_PASSWORD_LENGTH, generateTempPassword } from './temp-password';
import { isPasswordValid } from './password';

describe('Временный пароль для выдачи пользователю (Р-15)', () => {
  it('соответствует политике: длина, буквы и цифры', () => {
    for (let i = 0; i < 100; i += 1) {
      const password = generateTempPassword();
      expect(password).toHaveLength(TEMP_PASSWORD_LENGTH);
      expect(isPasswordValid(password)).toBe(true);
      expect(/[a-zA-Z]/.test(password)).toBe(true);
      expect(/[0-9]/.test(password)).toBe(true);
    }
  });

  it('не содержит символов, которые путают при диктовке', () => {
    // Пароль диктуют голосом и переписывают на бумагу: «0» вместо «O» — типовая ошибка входа.
    for (let i = 0; i < 100; i += 1) {
      expect(generateTempPassword()).not.toMatch(/[0O1lI]/);
    }
  });

  it('не повторяется', () => {
    const values = new Set(Array.from({ length: 300 }, () => generateTempPassword()));
    expect(values.size).toBe(300);
  });
});
