import { hasPermission, RoleCode } from '@prodtrack/contracts';
import type { WarehouseType } from '@prisma/client';

/**
 * Кто принимает перемещение — по типу склада-приёмника (решение владельца 21.10.2026, ОПЭ-28).
 *
 * Привязки «пользователь → склад» в системе нет: ни у пользователя, ни у сотрудника нет поля
 * склада. Поэтому единственное, чем приёмщик различается по документу, — тип склада назначения:
 * на склад ГП принимает КСГП (кладовщик склада ГП), на производственный — УСГП.
 *
 * До этой правки кнопку «Принять» видел любой, у кого есть `transfer:receive`, — включая того,
 * кто сам отправил документ, и того, чей склад к приёмке отношения не имеет.
 */
export function receivingRolesFor(destinationType: WarehouseType): RoleCode[] {
  return destinationType === 'FINISHED_GOODS' ? [RoleCode.KSGP] : [RoleCode.USGP];
}

/** Подпись для экрана «Доступ запрещён»: какие роли принимают на этом типе склада. */
export function receivingRolesLabel(destinationType: WarehouseType): string {
  return destinationType === 'FINISHED_GOODS' ? 'принимает КСГП' : 'принимает УСГП';
}

export function canReceiveTransfer(roles: string[], destinationType: WarehouseType): boolean {
  if (!hasPermission(roles, 'transfer:receive')) {
    return false;
  }
  if (roles.includes(RoleCode.ADM)) {
    return true;
  }
  const allowed = receivingRolesFor(destinationType);
  return roles.some((role) => allowed.includes(role as RoleCode));
}
