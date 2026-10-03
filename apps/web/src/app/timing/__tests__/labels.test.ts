import { describe, it, expect } from 'vitest';
import {
  documentTypeLabel,
  entityTypeLabel,
  initiatorLabel,
  statusLabel,
  transitionLabel,
} from '../labels';

describe('подписи экрана «Хронометраж» (M10 §8)', () => {
  it('переводит статусы документов и строк', () => {
    expect(statusLabel('DRAFT')).toBe('Черновик');
    expect(statusLabel('IN_PROGRESS')).toBe('В работе');
    expect(statusLabel('REPORTED')).toBe('Итог внесён');
    expect(statusLabel('CANCELLED')).toBe('Отменено');
    expect(statusLabel('')).toBe('создание');
  });

  it('показывает текущий этап для незакрытого перехода', () => {
    expect(statusLabel(null)).toBe('текущий этап');
    expect(transitionLabel('SUBMITTED', null)).toBe('Отправлено → …');
  });

  it('показывает переход «из → в»', () => {
    expect(transitionLabel('DRAFT', 'CONFIRMED')).toBe('Черновик → Подтверждено');
  });

  it('переводит типы документа и сущности', () => {
    expect(documentTypeLabel('PRODUCTION_ORDER')).toBe('ПЗ');
    expect(documentTypeLabel('GOODS_TRANSFER')).toBe('Перемещение');
    expect(entityTypeLabel('DOCUMENT')).toBe('документ');
    expect(entityTypeLabel('LINE')).toBe('строка');
  });

  it('показывает инициатора перехода (M10 BR-2)', () => {
    expect(initiatorLabel('NP', 'user-12345678')).toBe('NP / user-123');
    expect(initiatorLabel('KSGP', null)).toBe('KSGP');
    expect(initiatorLabel(null, null)).toBe('—');
  });
});
