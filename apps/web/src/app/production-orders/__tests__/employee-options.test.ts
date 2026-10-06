import { describe, it, expect } from 'vitest';
import type { Employee } from '@prisma/client';
import {
  buildEmployeeOptions,
  isEligible,
  NOT_OPERATOR_NOTE,
  NOT_WORKER_NOTE,
} from '../employee-options';

function employee(id: string, fullName: string, overrides: Partial<Employee> = {}): Employee {
  return {
    id,
    tabNumber: id,
    fullName,
    active: true,
    canBeWorker: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('Правила допуска к строке ПЗ (T-070, T-071)', () => {
  it('isEligible различает сотрудника из списка допуска и вне его', () => {
    const eligible = [employee('e1', 'Иванов И.И.')];

    expect(isEligible('e1', eligible)).toBe(true);
    expect(isEligible('e9', eligible)).toBe(false);
  });

  it('предлагает сотрудников из списка допуска', () => {
    expect(
      buildEmployeeOptions([employee('e1', 'Иванов И.И.'), employee('e2', 'Петров П.П.')]),
    ).toEqual([
      { value: 'e1', label: 'Иванов И.И.' },
      { value: 'e2', label: 'Петров П.П.' },
    ]);
  });

  it('помечает деактивированного сотрудника', () => {
    expect(buildEmployeeOptions([employee('e1', 'Иванов И.И.', { active: false })])).toEqual([
      { value: 'e1', label: 'Иванов И.И. (деактивирован)' },
    ]);
  });

  it('сохраняет назначенного Оператора без учётной записи ОПР и помечает его', () => {
    const options = buildEmployeeOptions(
      [employee('e1', 'Иванов И.И.')],
      [employee('e9', 'Складчиков С.С.')],
      NOT_OPERATOR_NOTE,
    );

    expect(options).toEqual([
      { value: 'e1', label: 'Иванов И.И.' },
      { value: 'e9', label: 'Складчиков С.С. (нет учётной записи ОПР)' },
    ]);
  });

  it('сохраняет работника без допуска к РЦ и помечает его (T-071)', () => {
    const options = buildEmployeeOptions(
      [employee('e1', 'Рабочий Р.Р.')],
      [employee('e9', 'Складчиков С.С.')],
      NOT_WORKER_NOTE,
    );

    expect(options).toEqual([
      { value: 'e1', label: 'Рабочий Р.Р.' },
      { value: 'e9', label: 'Складчиков С.С. (нет допуска работником РЦ)' },
    ]);
  });

  it('не дублирует назначенного сотрудника, прошедшего правило допуска', () => {
    const eligible = [employee('e1', 'Иванов И.И.')];

    expect(buildEmployeeOptions(eligible, eligible)).toHaveLength(1);
  });
});
