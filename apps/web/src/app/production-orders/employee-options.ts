import type { Employee } from '@prisma/client';

export interface EmployeeOption {
  value: string;
  label: string;
}

/** Пометка для сотрудника, который уже назначен, но больше не проходит правило допуска. */
export const NOT_OPERATOR_NOTE = ' (нет учётной записи ОПР)';
export const NOT_WORKER_NOTE = ' (нет допуска работником РЦ)';

/**
 * Правила допуска к строке ПЗ:
 * - Оператором может быть только сотрудник с активной учётной записью роли ОПР (T-070):
 *   M02 BR-1 связывает пользователя с сотрудником, а EV-01 разрешается диспетчером через
 *   `user.employeeId` — без учётной записи Оператор не получит уведомление и не сможет
 *   подтвердить получение ПЗ и внести итог;
 * - работником РЦ — только сотрудник с признаком «Может привлекаться работником РЦ»
 *   (T-071, M01 §4.1).
 */
export function isEligible(employeeId: string, eligible: Employee[]): boolean {
  return eligible.some((employee) => employee.id === employeeId);
}

/**
 * Варианты выбора сотрудника.
 *
 * `assigned` — сотрудники, уже назначенные в редактируемом ПЗ. Если такой сотрудник не
 * проходит правило допуска (учётную запись деактивировали, роль ОПР сняли, признак допуска
 * отозвали), он всё равно остаётся в списке с пометкой: иначе поле не нашло бы своё значение
 * и сохранение молча стёрло бы назначение — «поле не передано» ≠ «поле пустое» (урок Фазы 5).
 */
export function buildEmployeeOptions(
  eligible: Employee[],
  assigned: Employee[] = [],
  notEligibleNote = '',
): EmployeeOption[] {
  const allowed = new Set(eligible.map((employee) => employee.id));
  const merged = new Map<string, Employee>();
  for (const employee of eligible) {
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
      : employee.fullName + notEligibleNote,
  }));
}
