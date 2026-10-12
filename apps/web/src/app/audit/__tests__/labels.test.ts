import { describe, it, expect } from 'vitest';
import {
  auditActionLabel,
  auditChangeLabel,
  auditObjectIdLabel,
  auditObjectLabel,
  auditRoleLabel,
} from '../labels';

describe('подписи экрана «Аудит» (M13 §8)', () => {
  it('переводит действия пользователя', () => {
    expect(auditActionLabel('CREATE')).toBe('создание');
    expect(auditActionLabel('UPDATE')).toBe('изменение');
    expect(auditActionLabel('CANCEL')).toBe('отмена');
    expect(auditActionLabel('LOGIN')).toBe('вход');
    expect(auditActionLabel('LOGIN_FAILED')).toBe('неудачный вход');
  });

  it('показывает короткий идентификатор только у объектов с UUID', () => {
    // У обычных записей это UUID: префикс помогает различить однотипные объекты.
    expect(auditObjectIdLabel('6c5f86bb-1111-2222-3333-444455556666')).toBe('6c5f86bb');
    // У системных записей идентификатор — служебный маркер, и его обрезка читалась бы как битый код.
    expect(auditObjectIdLabel('data-cleanup')).toBeNull();
    expect(auditObjectIdLabel(null)).toBeNull();
    expect(auditObjectIdLabel(undefined)).toBeNull();
  });

  it('переводит типы объектов', () => {
    expect(auditObjectLabel('ProductionOrder')).toBe('ПЗ');
    expect(auditObjectLabel('GoodsTransfer')).toBe('Перемещение');
    expect(auditObjectLabel('Discrepancy')).toBe('расхождение');
  });

  it('показывает изменение «поле: старое → новое» (Р-09)', () => {
    expect(auditChangeLabel('status', 'DRAFT', 'CONFIRMED')).toBe('status: DRAFT → CONFIRMED');
    expect(auditChangeLabel('quantity', '10', '8')).toBe('quantity: 10 → 8');
  });

  it('показывает только новое значение, если старого нет', () => {
    expect(auditChangeLabel(null, null, '{"shiftId":"s-1"}')).toBe('{"shiftId":"s-1"}');
  });

  it('показывает прочерк, если значений нет', () => {
    expect(auditChangeLabel(null, null, null)).toBe('—');
  });

  it('показывает роль атрибуции (Р-23)', () => {
    expect(auditRoleLabel('OPR')).toBe('OPR');
    expect(auditRoleLabel(null)).toBe('—');
  });
});
