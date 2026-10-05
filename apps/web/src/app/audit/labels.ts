// Чистые хелперы экрана «Аудит» (M13 §8).

import { AuditAction } from '@prodtrack/contracts';

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  [AuditAction.CREATE]: 'создание',
  [AuditAction.UPDATE]: 'изменение',
  [AuditAction.DELETE]: 'удаление',
  [AuditAction.LOGIN]: 'вход',
  [AuditAction.LOGOUT]: 'выход',
  [AuditAction.LOGIN_FAILED]: 'неудачный вход',
  [AuditAction.CANCEL]: 'отмена',
};

export const AUDIT_OBJECT_LABELS: Record<string, string> = {
  ProductionOrder: 'ПЗ',
  ProductionOrderLine: 'строка ПЗ',
  ProductionFact: 'факт производства',
  GoodsTransfer: 'Перемещение',
  TransferLine: 'строка Перемещения',
  Discrepancy: 'расхождение',
  StockMovement: 'движение остатков',
  StockBalance: 'остаток',
  User: 'пользователь',
  Role: 'роль',
  Shift: 'смена',
  WorkCenter: 'РЦ',
  Product: 'номенклатура',
  Employee: 'сотрудник',
  DefectReason: 'причина брака',
  SubstitutionReason: 'причина ввода за Оператора',
  Warehouse: 'склад',
  TaskForOneC: 'задача для 1С',
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

export function auditObjectLabel(objectType: string): string {
  return AUDIT_OBJECT_LABELS[objectType] ?? objectType;
}

/** Роль атрибутируется автоматически при записи (M13 BR-X, Р-23). */
export function auditRoleLabel(role: string | null): string {
  return role ?? '—';
}

/** Значение «старое → новое» для таблицы аудита (Р-09). */
export function auditChangeLabel(
  field: string | null,
  oldValue: string | null,
  newValue: string | null,
): string {
  const parts: string[] = [];
  if (field) {
    parts.push(field);
  }
  if (oldValue !== null && newValue !== null) {
    parts.push(oldValue + ' → ' + newValue);
  } else if (newValue !== null) {
    parts.push(newValue);
  } else if (oldValue !== null) {
    parts.push(oldValue);
  }
  return parts.length > 0 ? parts.join(': ') : '—';
}
