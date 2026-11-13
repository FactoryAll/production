// Чистые хелперы экрана «Аудит» (M13 §8).

import { AuditAction } from '@prodtrack/contracts';
import { AUDIT_VALUE_LABELS, auditKeyLabel, humanizeAuditValue } from '@/lib/audit/humanize';

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
  // Экран «Данные» (T-076): очистка операционных данных администратором.
  DataCleanup: 'очистка данных',
  // Загрузка номенклатуры из файла (этап 5): сводная запись о загруженном файле.
  ProductImport: 'загрузка номенклатуры',
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

export function auditObjectLabel(objectType: string): string {
  return AUDIT_OBJECT_LABELS[objectType] ?? objectType;
}

/**
 * Короткий идентификатор объекта для журнала — или null, если показывать его нечего.
 *
 * У обычных записей это UUID, и префикс помогает различить однотипные объекты. У системных
 * записей идентификатор — служебный маркер (например, `data-cleanup` для очистки данных),
 * и его обрезка до восьми символов читается как битый код, поэтому такие значения скрываются.
 */
export function auditObjectIdLabel(objectId: string | null | undefined): string | null {
  if (!objectId) {
    return null;
  }
  return /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(objectId) ? objectId.slice(0, 8) : null;
}

/** Роль атрибутируется автоматически при записи (M13 BR-X, Р-23). */
export function auditRoleLabel(role: string | null): string {
  return role ?? '—';
}

/** Значение «старое → новое» для таблицы аудита (Р-09). */
/**
 * Подпись изменения для журнала.
 *
 * 14.11.2026: значения-объекты раскладываются по полям, а идентификаторы подменяются
 * названиями из `names` — раньше в журнал попадал дамп вида `{"id":"b35b2488-…"}`, и
 * читать его было нельзя. Если словаря нет, поведение прежнее (значение как есть),
 * поэтому старые экраны и тесты не меняются.
 */
export function auditChangeLabel(
  field: string | null,
  oldValue: string | null,
  newValue: string | null,
  names: Record<string, string> = {},
): string {
  const parts: string[] = [];
  if (field) {
    parts.push(auditKeyLabel(field));
  }
  const printable = (value: string): string => {
    const asJson = humanizeAuditValue(value, names);
    if (asJson !== null) {
      return asJson;
    }
    // Статусы и категории читаются лучше по-русски: «Черновик → Подтверждено».
    return names[value] ?? AUDIT_VALUE_LABELS[value] ?? value;
  };
  if (oldValue !== null && newValue !== null) {
    parts.push(printable(oldValue) + ' → ' + printable(newValue));
  } else if (newValue !== null) {
    parts.push(printable(newValue));
  } else if (oldValue !== null) {
    parts.push(printable(oldValue));
  }
  return parts.length > 0 ? parts.join(': ') : '—';
}
