import { describe, it, expect } from 'vitest';
import {
  DOCUMENT_STATUS_OPTIONS,
  DOCUMENT_TYPE_OPTIONS,
  parseDocumentStatus,
  parseDocumentType,
} from '../filters';

describe('Фильтры списка документов дашборда (M11 §8)', () => {
  it('тип документа по умолчанию — все документы', () => {
    expect(parseDocumentType(undefined)).toBe('ALL');
    expect(parseDocumentType('nonsense')).toBe('ALL');
    expect(parseDocumentType('GOODS_TRANSFER')).toBe('GOODS_TRANSFER');
  });

  it('статус по умолчанию — все статусы', () => {
    expect(parseDocumentStatus(undefined)).toBe('ALL');
    expect(parseDocumentStatus('nonsense')).toBe('ALL');
    expect(parseDocumentStatus('IN_PROGRESS')).toBe('IN_PROGRESS');
  });

  it('в списке статусов нет повторов: DRAFT и CANCELLED общие для обоих типов', () => {
    const values = DOCUMENT_STATUS_OPTIONS.map((option) => option.value);

    expect(new Set(values).size).toBe(values.length);
    expect(values).toContain('CONFIRMED');
    expect(values).toContain('RECEIVED');
  });

  it('статусы подписаны по 00 §3', () => {
    const labels = Object.fromEntries(
      DOCUMENT_STATUS_OPTIONS.map((option) => [option.value, option.label]),
    );

    expect(labels.CONFIRMED).toBe('Подтверждено');
    expect(labels.DISCREPANCY).toBe('Расхождение');
  });

  it('типы документов подписаны', () => {
    expect(DOCUMENT_TYPE_OPTIONS.map((option) => option.label)).toEqual([
      'Все документы',
      'ПЗ',
      'Перемещения',
    ]);
  });
});
