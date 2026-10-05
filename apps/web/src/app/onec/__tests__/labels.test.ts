import { describe, it, expect } from 'vitest';
import {
  factCategoryLabel,
  formatTaskDateTime,
  oneCStatusLabel,
  oneCTypeLabel,
  taskDocumentLabel,
  taskSummary,
} from '../labels';
import type { OneCTaskData } from '@/lib/onec/task-data';

const production: OneCTaskData = {
  taskType: 'PRODUCTION',
  productionOrderId: 'po-1',
  shiftNumber: 2,
  shiftDate: '2026-10-06',
  completedAt: '2026-10-06T20:15:00.000Z',
  output: [
    {
      workCenterCode: '01',
      workCenterName: 'РЦ 01',
      productCode: 'GP-001',
      productName: 'Крем',
      category: 'GP',
      quantity: '80.0000',
      unit: 'шт',
    },
  ],
  consumption: [
    {
      workCenterCode: '01',
      workCenterName: 'РЦ 01',
      productCode: 'M-001',
      productName: 'Масса',
      quantity: '70.25',
      unit: 'кг',
    },
  ],
};

const transfer: OneCTaskData = {
  taskType: 'TRANSFER',
  transferId: 'tr-1',
  status: 'SUBMITTED',
  sourceWarehouse: 'Производственный склад',
  destinationWarehouse: 'Склад ГП',
  submittedAt: null,
  lines: [
    {
      productCode: 'GP-001',
      productName: 'Крем',
      plannedQuantity: '100.00',
      actualQuantity: null,
      unit: 'шт',
    },
  ],
};

describe('подписи рабочего места 1С (M12 §2, §8)', () => {
  it('подписывает тип и статус задачи', () => {
    expect(oneCTypeLabel('PRODUCTION')).toBe('Производство');
    expect(oneCTypeLabel('TRANSFER')).toBe('Перемещение');
    expect(oneCStatusLabel('PENDING')).toBe('Ожидает');
    expect(oneCStatusLabel('PROCESSED')).toBe('Обработано');
  });

  it('подписывает категорию выпуска (Р-01)', () => {
    expect(factCategoryLabel('MASS')).toBe('Масса');
    expect(factCategoryLabel('GP')).toBe('ГП');
    expect(factCategoryLabel('PF')).toBe('ПФ');
  });

  it('описывает документ-источник для обоих типов', () => {
    expect(taskDocumentLabel(production)).toBe('Смена 2 от 06.10.2026');
    expect(taskDocumentLabel(transfer)).toBe('Производственный склад → Склад ГП');
    expect(taskDocumentLabel(null)).toBe('—');
  });

  it('даёт краткую сводку данных', () => {
    expect(taskSummary(production)).toBe('Выпуск: 1 поз. · Потребление: 1 поз.');
    expect(taskSummary(transfer)).toBe('Позиций: 1');
    expect(taskSummary(null)).toBe('—');
  });

  it('форматирует дату и время', () => {
    expect(formatTaskDateTime('2026-10-06T20:15:00.000Z')).toContain('2026');
  });
});
