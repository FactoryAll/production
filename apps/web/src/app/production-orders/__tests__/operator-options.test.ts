import { describe, it, expect } from 'vitest';
import type { Employee } from '@prisma/client';
import { buildOperatorOptions, canOperate } from '../operator-options';

function employee(id: string, fullName: string, active = true): Employee {
  return { id, tabNumber: id, fullName, active, createdAt: new Date(), updatedAt: new Date() };
}

describe('Поле «Оператор»: состав списка (T-070, M03 §2, M02 BR-1)', () => {
  it('предлагает сотрудников с активной учётной записью роли ОПР', () => {
    expect(buildOperatorOptions([employee('e1', 'Иванов И.И.'), employee('e2', 'Петров П.П.')])).toEqual([
      { value: 'e1', label: 'Иванов И.И.' },
      { value: 'e2', label: 'Петров П.П.' },
    ]);
  });

  it('помечает деактивированного сотрудника', () => {
    expect(buildOperatorOptions([employee('e1', 'Иванов И.И.', false)])).toEqual([
      { value: 'e1', label: 'Иванов И.И. (деактивирован)' },
    ]);
  });

  it('сохраняет назначенного Оператора без учётной записи ОПР и помечает его', () => {
    const options = buildOperatorOptions([employee('e1', 'Иванов И.И.')], [employee('e9', 'Складчиков С.С.')]);

    expect(options).toEqual([
      { value: 'e1', label: 'Иванов И.И.' },
      { value: 'e9', label: 'Складчиков С.С. (нет учётной записи ОПР)' },
    ]);
  });

  it('не дублирует назначенного Оператора, прошедшего фильтр', () => {
    const operators = [employee('e1', 'Иванов И.И.')];

    expect(buildOperatorOptions(operators, operators)).toHaveLength(1);
  });

  it('canOperate различает сотрудника с учётной записью ОПР и без неё', () => {
    const operators = [employee('e1', 'Иванов И.И.')];

    expect(canOperate('e1', operators)).toBe(true);
    expect(canOperate('e9', operators)).toBe(false);
  });
});
