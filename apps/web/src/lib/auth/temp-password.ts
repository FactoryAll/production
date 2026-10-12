import { randomInt } from 'crypto';

/**
 * Временный пароль, который администратор выдаёт пользователю (Р-15, M02).
 *
 * Источник случайности — криптостойкий: временный пароль даёт доступ к системе, и предсказуемое
 * значение здесь недопустимо (прежняя версия использовала Math.random).
 *
 * Алфавит без визуально похожих символов (0/O, 1/l/I): пароль диктуют голосом и переписывают
 * на бумагу, а «ноль вместо буквы О» — типовая ошибка входа. Буква и цифра входят в пароль
 * гарантированно, поэтому он всегда проходит политику: не менее 8 символов, буквы и цифры.
 */
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';

export const TEMP_PASSWORD_LENGTH = 12;

export function generateTempPassword(): string {
  const alphabet = LETTERS + DIGITS;
  const chars = [LETTERS[randomInt(LETTERS.length)], DIGITS[randomInt(DIGITS.length)]];

  while (chars.length < TEMP_PASSWORD_LENGTH) {
    chars.push(alphabet[randomInt(alphabet.length)]);
  }

  // Перемешивание: иначе буква и цифра всегда стоят на первых двух местах.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    const swap = chars[i];
    chars[i] = chars[j];
    chars[j] = swap;
  }

  return chars.join('');
}
