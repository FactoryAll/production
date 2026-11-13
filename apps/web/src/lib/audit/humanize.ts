// Человекочитаемый вывод значений аудита (14.11.2026).
//
// Замечание владельца: в журнале лежал дамп вроде
//   transfer: {"id":"b35b2488-…","status":"DRAFT","sourceWarehouseId":"3096fa83-…",…}
// и пользы от такой записи не было: идентификаторы ничего не говорят человеку.
// Здесь JSON-значение превращается в набор «подпись: значение», а идентификаторы
// подменяются названиями, если они есть в переданном словаре.

/** Подписи ключей, которые встречаются в значениях аудита. */
export const AUDIT_KEY_LABELS: Record<string, string> = {
  id: 'идентификатор',
  status: 'статус',
  sourceWarehouseId: 'склад-источник',
  destinationWarehouseId: 'склад-получатель',
  productId: 'номенклатура',
  plannedQuantity: 'количество по плану',
  quantity: 'количество',
  actualQuantity: 'принятое количество',
  lineId: 'строка',
  lineIds: 'строки',
  orderId: 'ПЗ',
  shiftId: 'смена',
  warehouseId: 'склад',
  userId: 'пользователь',
  employeeId: 'сотрудник',
  workCenterId: 'РЦ',
  defectQuantity: 'брак',
  defectReasonId: 'причина брака',
  factCategory: 'категория факта',
  stockCategory: 'категория остатка',
  consumption: 'потребление',
  lines: 'строки',
  linesCount: 'число строк',
  reasonCode: 'код причины',
  comment: 'комментарий',
  planned: 'план',
  worked: 'отработано',
  name: 'название',
  code: 'код',
  login: 'логин',
  role: 'роль',
  email: 'почта',
  active: 'активен',
  unit: 'единица',
  category: 'категория',
  fullName: 'ФИО',
  tabNumber: 'табельный номер',
  stopsCount: 'остановок',
  stopsDurationMinutes: 'остановки, мин',
  outputRaw: 'что было в поле',
  outputHistory: 'журнал ввода',
};

/** Статусы, которые встречаются в значениях: показываем как в интерфейсе. */
export const AUDIT_VALUE_LABELS: Record<string, string> = {
  DRAFT: 'Черновик',
  CONFIRMED: 'Подтверждено',
  IN_PROGRESS: 'В работе',
  COMPLETED: 'Завершено',
  CANCELLED: 'Отменено',
  SUBMITTED: 'Отправлено',
  RECEIVED: 'Принято складом',
  DISCREPANCY: 'Расхождение',
  RECONCILED: 'Согласовано',
  ASSIGNED: 'Назначено',
  ACCEPTED: 'Принято оператором',
  REPORTED: 'Отчитано',
  GP: 'ГП',
  PF: 'ПФ',
  MASS: 'Масса',
  true: 'да',
  false: 'нет',
};

export function auditKeyLabel(key: string): string {
  return AUDIT_KEY_LABELS[key] ?? key;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

/**
 * Значение одного поля: идентификатор подменяется названием из словаря,
 * известные статусы — русской подписью, массивы объектов — их числом.
 */
export function humanizeAuditScalar(
  key: string,
  value: unknown,
  names: Record<string, string>,
): string {
  if (value === null || value === undefined) {
    return '—';
  }
  if (typeof value === 'string') {
    if (names[value]) {
      return names[value];
    }
    if (AUDIT_VALUE_LABELS[value]) {
      return AUDIT_VALUE_LABELS[value];
    }
    // Ссылка на объект без названия в словаре: показываем короткий код, а не весь UUID.
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(value)) {
      return `#${shortId(value)}`;
    }
    return value;
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return 'пусто';
    }
    const parts = value.map((item) => (isPlainObject(item) ? humanizeAuditObject(item, names, 1) : humanizeAuditScalar(key, item, names)));
    return parts.join('; ');
  }
  if (isPlainObject(value)) {
    return humanizeAuditObject(value, names, 1);
  }
  return String(value);
}

/** JSON-объект как «подпись: значение; подпись: значение». */
export function humanizeAuditObject(
  value: Record<string, unknown>,
  names: Record<string, string>,
  depth = 0,
): string {
  const parts: string[] = [];
  for (const [key, item] of Object.entries(value)) {
    if (isPlainObject(item) || Array.isArray(item)) {
      if (depth >= 2) {
        continue;
      }
      parts.push(`${auditKeyLabel(key)}: {${humanizeAuditScalar(key, item, names)}}`);
      continue;
    }
    parts.push(`${auditKeyLabel(key)}: ${humanizeAuditScalar(key, item, names)}`);
  }
  return parts.join('; ');
}

/**
 * Разбор значения аудита: если это JSON — раскладываем по полям,
 * иначе возвращаем null (значение обычное и печатается как есть).
 */
export function humanizeAuditValue(value: string | null, names: Record<string, string>): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (isPlainObject(parsed)) {
      return humanizeAuditObject(parsed, names);
    }
    if (Array.isArray(parsed)) {
      return humanizeAuditScalar('', parsed, names);
    }
    return null;
  } catch {
    return null;
  }
}
