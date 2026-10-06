import type { Employee } from '@prisma/client';

export interface OperatorOption {
  value: string;
  label: string;
}

/**
 * Может ли сотрудник исполнить ПЗ со своей учётной записи (T-070).
 *
 * M02 BR-1 связывает пользователя с сотрудником, а EV-01 разрешается диспетчером через
 * `user.employeeId` (M03 §5). Поэтому Оператором имеет смысл предлагать только сотрудника
 * с активной учётной записью роли ОПР: остальные не получат уведомление и не смогут
 * подтвердить получение ПЗ и внести итог — ПЗ пришлось бы закрывать вводом за Оператора (Р-11).
 */
export function canOperate(employeeId: string, operators: Employee[]): boolean {
  return operators.some((employee) => employee.id === employeeId);
}

/**
 * Варианты поля «Оператор».
 *
 * `assigned` — сотрудники, уже назначенные Операторами в редактируемом ПЗ. Если такой
 * сотрудник не проходит фильтр (учётную запись деактивировали или сняли роль ОПР), он всё
 * равно остаётся в списке с пометкой: иначе `<select>` не нашёл бы своё значение и
 * сохранение молча стёрло бы Оператора — «поле не передано» ≠ «поле пустое» (урок Фазы 5).
 */
export function buildOperatorOptions(
  operators: Employee[],
  assigned: Employee[] = [],
): OperatorOption[] {
  const allowed = new Set(operators.map((employee) => employee.id));
  const merged = new Map<string, Employee>();
  for (const employee of operators) {
    merged.set(employee.id, employee);
  }
  for (const employee of assigned) {
    if (!merged.has(employee.id)) {
      merged.set(employee.id, employee);
    }
  }

  return [...merged.values()].map((employee) => ({
    value: employee.id,
    label: allowed.has(employee.id)
      ? employee.fullName + (employee.active ? '' : ' (деактивирован)')
      : employee.fullName + ' (нет учётной записи ОПР)',
  }));
}
