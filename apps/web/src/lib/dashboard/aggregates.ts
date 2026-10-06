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

/** Возраст в формате «чч:мм» (Р-05). */
export function formatAge(ms: number | null): string {
  return ms === null ? '—' : formatDuration(ms / 60000);
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
