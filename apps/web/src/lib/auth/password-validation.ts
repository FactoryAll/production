export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

export function validatePassword(password: string): PasswordValidationResult {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push('Пароль должен содержать не менее 8 символов');
  }

  if (!/[a-zA-Zа-яА-Я]/.test(password)) {
    errors.push('Пароль должен содержать буквы');
  }

  if (!/[0-9]/.test(password)) {
    errors.push('Пароль должен содержать цифры');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}