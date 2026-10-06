// Чистые расчёты виджетов дашборда M11 (Р-08).
//
// Обычный модуль без 'use server': в 'use server'-файле каждый экспорт становится
// Server Reference, и вызов такой функции при рендере падает (урок Фазы 3/4).

import { formatDuration } from '@/lib/format';

export interface CategoryTotals {
  /** Масса, кг. */
  mass: number;
  /** Полуфабрикат, шт (Р-01: ПФ — состояние ГП-позиции). */
  pf: number;
  /** Готовая продукция, шт. */
  gp: number;
}

export function emptyTotals(): CategoryTotals {
  return { mass: 0, pf: 0, gp: 0 };
}

/**
 * Возраст документа — время нахождения в текущем статусе (M11 §8, M10 §5).
 * Если переходов ещё не было (черновик только создан), отсчёт идёт от создания.
 */
export function documentAgeMs(now: Date, lastTransitionAt: Date | null, createdAt: Date): number {
  const since = lastTransitionAt ?? createdAt;
  return Math.max(0, now.getTime() - since.getTime());
}

/**
 * Возраст документа (M11 §8).
 *
 * До суток — «чч:мм», как длительности в отчётах (Р-05). От суток добавляются дни:
 * «1006:59» нечитаемо, а возраст документов в списке легко превышает сутки.
 */
export function formatAge(ms: number | null): string {
  if (ms === null) {
    return '—';
  }
  const minutes = Math.max(0, Math.round(ms / 60000));
  const days = Math.floor(minutes / (24 * 60));
  return days === 0 ? formatDuration(minutes) : days + ' д ' + formatDuration(minutes - days * 24 * 60);
}

/**
 * Русская форма существительного при числе: 1 перемещение, 2 перемещения, 5 перемещений.
 * Без неё в подписях виджетов получается «2 перемещений».
 */
export function plural(count: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(count) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) {
    return many;
  }
  if (mod10 === 1) {
    return one;
  }
  return mod10 >= 2 && mod10 <= 4 ? few : many;
}

export interface StageDurationItem {
  fromStatus: string;
  toStatus: string;
  durationMs: number;
}

export interface StageDurationSummary {
  fromStatus: string;
  toStatus: string;
  count: number;
  averageMs: number;
  maxMs: number;
}

/**
 * Средние и максимальные длительности этапов за период (M11 §8: «длительности этапов» из M10).
 * Этапы с одинаковой парой статусов складываются; порядок — по убыванию средней длительности.
 */
export function summarizeStageDurations(
  items: StageDurationItem[],
  limit = 10,
): StageDurationSummary[] {
  const grouped = new Map<string, StageDurationItem[]>();

  for (const item of items) {
    const key = item.fromStatus + '\u0000' + item.toStatus;
    const list = grouped.get(key);
    if (list) {
      list.push(item);
    } else {
      grouped.set(key, [item]);
    }
  }

  return [...grouped.values()]
    .map((group) => ({
      fromStatus: group[0].fromStatus,
      toStatus: group[0].toStatus,
      count: group.length,
      averageMs: Math.round(
        group.reduce((sum, item) => sum + item.durationMs, 0) / group.length,
      ),
      maxMs: Math.max(...group.map((item) => item.durationMs)),
    }))
    .sort((left, right) => right.averageMs - left.averageMs)
    .slice(0, limit);
}
