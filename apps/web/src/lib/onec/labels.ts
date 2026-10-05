import type { TaskForOneCStatus, TaskForOneCType } from '@prisma/client';
import type { OneCTaskData } from '@/lib/onec/task-data';

/** Подписи рабочего места С1С (M12 §2, §8). */

export const ONE_C_TYPE_LABELS: Record<TaskForOneCType, string> = {
  PRODUCTION: 'Производство',
  TRANSFER: 'Перемещение',
};

export const ONE_C_STATUS_LABELS: Record<TaskForOneCStatus, string> = {
  PENDING: 'Ожидает',
  PROCESSED: 'Обработано',
  CANCELLED: 'Отменена',
};

export function oneCTypeLabel(type: TaskForOneCType): string {
  return ONE_C_TYPE_LABELS[type] ?? type;
}

export function oneCStatusLabel(status: TaskForOneCStatus): string {
  return ONE_C_STATUS_LABELS[status] ?? status;
}

/** Категория выпуска (Р-01): Масса / ГП / ПФ. */
export const FACT_CATEGORY_LABELS: Record<'MASS' | 'GP' | 'PF', string> = {
  MASS: 'Масса',
  GP: 'ГП',
  PF: 'ПФ',
};

export function factCategoryLabel(category: 'MASS' | 'GP' | 'PF'): string {
  return FACT_CATEGORY_LABELS[category] ?? category;
}

function formatDate(date: string): string {
  const [year, month, day] = date.split('-');
  return day && month && year ? `${day}.${month}.${year}` : date;
}

/** Документ-источник: для «Производства» — смена, для «Перемещения» — склады. */
export function taskDocumentLabel(data: OneCTaskData | null): string {
  if (!data) return '—';
  if (data.taskType === 'PRODUCTION') {
    return `Смена ${data.shiftNumber} от ${formatDate(data.shiftDate)}`;
  }
  return `${data.sourceWarehouse} → ${data.destinationWarehouse}`;
}

/** Краткая сводка данных: сколько позиций выпуска/потребления или строк перемещения. */
export function taskSummary(data: OneCTaskData | null): string {
  if (!data) return '—';
  if (data.taskType === 'PRODUCTION') {
    return `Выпуск: ${data.output.length} поз. · Потребление: ${data.consumption.length} поз.`;
  }
  return `Позиций: ${data.lines.length}`;
}

export function formatTaskDateTime(value: Date | string): string {
  return new Date(value).toLocaleString('ru-RU');
}
