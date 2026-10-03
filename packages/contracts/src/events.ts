// Каталог событий M09 — единый источник истины по событиям EV-01…EV-10
// (спеки: 00_System_Overview §5, M09_InApp_Notifications §7).
//
// Здесь описано `что` за событие: код в форме спека и в форме Prisma-энума,
// название, заголовок уведомления, правило адресации, построение deep-link
// и валидация payload. Запись уведомлений выполняет kernel (`emitEvent`, T-059);
// каталог сам в БД не пишет.

import type { EventCodeValue, RoleCodeValue, SubstitutionReasonValue } from './index';

/** Код события в форме Prisma-энумерации `EventCode` (записывается в БД). */
export type DbEventCode =
  | 'EV_01'
  | 'EV_02'
  | 'EV_03'
  | 'EV_04'
  | 'EV_05'
  | 'EV_06'
  | 'EV_07'
  | 'EV_08'
  | 'EV_09'
  | 'EV_10';

/** Пресет причин «ввода за Оператора» (Р-13, 00 §5). */
export const SUBSTITUTION_REASON_CODES: readonly string[] = [
  'ILLNESS',
  'NO_SHOW',
  'LEFT_SHIFT',
  'OTHER',
];

/** Ссылка на склад в payload события. */
export interface WarehouseRef {
  id: string;
  name: string;
}

export interface Event01Payload {
  orderId: string;
  shiftId: string;
  shiftName?: string;
  linesCount: number;
}

export interface Event02Payload {
  orderId: string;
  lineId: string;
  workCenterId: string;
  operatorId: string;
}

export interface Event03Payload {
  orderId: string;
  lineId: string;
  factIds: string[];
  workCenterId?: string;
  operatorId?: string;
}

export interface Event04Payload {
  transferId: string;
  sourceWarehouse: WarehouseRef;
  destinationWarehouse: WarehouseRef;
  linesCount: number;
}

export interface Event05Payload {
  transferId: string;
  sourceWarehouse: WarehouseRef;
  destinationWarehouse: WarehouseRef;
}

export interface Event06Payload {
  transferId: string;
  sourceWarehouse: WarehouseRef;
  destinationWarehouse: WarehouseRef;
  discrepanciesCount: number;
}

export interface Event07Payload {
  transferId: string;
  discrepanciesCount: number;
  reconciledByUserId: string;
}

/** Payload EV-08 (Р-13): причина из пресета + обязательный комментарий. */
export interface Event08Payload {
  orderId: string;
  lineId: string;
  operatorId: string;
  reasonCode: SubstitutionReasonValue;
  comment: string;
  factIds: string[];
}

export interface Event09Payload {
  orderId: string;
  reason: string;
  cancelledAt: string;
  cancelledByUserId: string;
}

export interface Event10Payload {
  transferId: string;
  sourceWarehouse: WarehouseRef;
  destinationWarehouse: WarehouseRef;
  status: 'CANCELLED';
}

/** Payload по коду события в форме спека. */
export interface EventPayloads {
  'EV-01': Event01Payload;
  'EV-02': Event02Payload;
  'EV-03': Event03Payload;
  'EV-04': Event04Payload;
  'EV-05': Event05Payload;
  'EV-06': Event06Payload;
  'EV-07': Event07Payload;
  'EV-08': Event08Payload;
  'EV-09': Event09Payload;
  'EV-10': Event10Payload;
}

/** Правило адресации уведомления (M09 BR-3, 00 §5). */
export type RecipientRule =
  | { kind: 'ROLE'; role: RoleCodeValue }
  | { kind: 'ORDER_OPERATORS' }
  | { kind: 'LINE_OPERATOR' };

export interface NotificationEventDefinition<K extends EventCodeValue = EventCodeValue> {
  /** Код события в форме спека (EV-01…EV-10). */
  code: K;
  /** Код события в форме Prisma-энума. */
  dbCode: DbEventCode;
  /** Название события из каталога 00 §5. */
  name: string;
  /** Заголовок уведомления. */
  title: string;
  /** Адресаты уведомления. */
  recipients: readonly RecipientRule[];
  /** Построение deep-link на целевой объект (M09 BR-2). */
  deepLink: (payload: EventPayloads[K]) => string;
  /** Валидация и нормализация payload; при ошибке выбрасывает EventPayloadError. */
  validatePayload: (raw: unknown) => EventPayloads[K];
}

/** Ошибка валидации payload события. */
export class EventPayloadError extends Error {
  readonly code: EventCodeValue;

  readonly issues: string[];

  constructor(code: EventCodeValue, issues: string[]) {
    super(`Некорректный payload события ${code}: ${issues.join('; ')}`);
    this.name = 'EventPayloadError';
    this.code = code;
    this.issues = issues;
  }
}

function asRecord(raw: unknown, code: EventCodeValue): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new EventPayloadError(code, ['payload должен быть объектом']);
  }
  return raw as Record<string, unknown>;
}

function requireString(
  record: Record<string, unknown>,
  field: string,
  issues: string[],
  /** Человекочитаемое имя поля для сообщения об ошибке (по умолчанию — имя поля payload). */
  label: string = field,
): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim() === '') {
    issues.push(`поле «${label}» — обязательная непустая строка`);
    return '';
  }
  return value;
}

function optionalString(
  record: Record<string, unknown>,
  field: string,
  issues: string[],
): string | undefined {
  const value = record[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    issues.push(`поле «${field}» должно быть строкой`);
    return undefined;
  }
  return value;
}

function requireNumber(
  record: Record<string, unknown>,
  field: string,
  issues: string[],
): number {
  const value = record[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push(`поле «${field}» — обязательное число`);
    return 0;
  }
  return value;
}

function requireStringArray(
  record: Record<string, unknown>,
  field: string,
  issues: string[],
): string[] {
  const value = record[field];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    issues.push(`поле «${field}» — обязательный массив строк`);
    return [];
  }
  return value as string[];
}

function requireWarehouse(
  record: Record<string, unknown>,
  field: string,
  issues: string[],
): WarehouseRef {
  const value = record[field];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    issues.push(`поле «${field}» — обязательный объект { id, name }`);
    return { id: '', name: '' };
  }
  const nested = value as Record<string, unknown>;
  return {
    id: requireString(nested, 'id', issues),
    name: requireString(nested, 'name', issues),
  };
}

function requireOneOf(
  record: Record<string, unknown>,
  field: string,
  allowed: readonly string[],
  issues: string[],
  label: string,
): string {
  const value = record[field];
  if (typeof value !== 'string' || !allowed.includes(value)) {
    issues.push(`поле «${field}» — ${label} (${allowed.join(', ')})`);
    return '';
  }
  return value;
}

function failIfIssues(code: EventCodeValue, issues: string[]): void {
  if (issues.length > 0) {
    throw new EventPayloadError(code, issues);
  }
}

function orderCardLink(payload: { orderId: string }): string {
  return `/production-orders/${payload.orderId}`;
}

function transferCardLink(payload: { transferId: string }): string {
  return `/transfers/${payload.transferId}`;
}

/**
 * Каталог событий. Порядок и состав соответствуют 00_System_Overview §5.
 */
export const EVENT_CATALOG: { [K in EventCodeValue]: NotificationEventDefinition<K> } = {
  'EV-01': {
    code: 'EV-01',
    dbCode: 'EV_01',
    name: 'ПЗ подтверждено',
    title: 'Подтверждено производственное задание',
    recipients: [{ kind: 'ORDER_OPERATORS' }],
    deepLink: orderCardLink,
    validatePayload: (raw) => {
      const record = asRecord(raw, 'EV-01');
      const issues: string[] = [];
      const payload: Event01Payload = {
        orderId: requireString(record, 'orderId', issues),
        shiftId: requireString(record, 'shiftId', issues),
        linesCount: requireNumber(record, 'linesCount', issues),
      };
      const shiftName = optionalString(record, 'shiftName', issues);
      if (shiftName !== undefined) {
        payload.shiftName = shiftName;
      }
      failIfIssues('EV-01', issues);
      return payload;
    },
  },

  'EV-02': {
    code: 'EV-02',
    dbCode: 'EV_02',
    name: 'Получение ПЗ подтверждено',
    title: 'Оператор подтвердил получение ПЗ',
    recipients: [{ kind: 'ROLE', role: 'NP' }],
    deepLink: orderCardLink,
    validatePayload: (raw) => {
      const record = asRecord(raw, 'EV-02');
      const issues: string[] = [];
      const payload: Event02Payload = {
        orderId: requireString(record, 'orderId', issues),
        lineId: requireString(record, 'lineId', issues),
        workCenterId: requireString(record, 'workCenterId', issues),
        operatorId: requireString(record, 'operatorId', issues),
      };
      failIfIssues('EV-02', issues);
      return payload;
    },
  },

  'EV-03': {
    code: 'EV-03',
    dbCode: 'EV_03',
    name: 'Итог смены внесён',
    title: 'Итог смены внесён',
    recipients: [{ kind: 'ROLE', role: 'S1C' }],
    deepLink: orderCardLink,
    validatePayload: (raw) => {
      const record = asRecord(raw, 'EV-03');
      const issues: string[] = [];
      const payload: Event03Payload = {
        orderId: requireString(record, 'orderId', issues),
        lineId: requireString(record, 'lineId', issues),
        factIds: requireStringArray(record, 'factIds', issues),
      };
      const workCenterId = optionalString(record, 'workCenterId', issues);
      if (workCenterId !== undefined) {
        payload.workCenterId = workCenterId;
      }
      const operatorId = optionalString(record, 'operatorId', issues);
      if (operatorId !== undefined) {
        payload.operatorId = operatorId;
      }
      failIfIssues('EV-03', issues);
      return payload;
    },
  },

  'EV-04': {
    code: 'EV-04',
    dbCode: 'EV_04',
    name: 'Перемещение отправлено',
    title: 'Перемещение отправлено',
    recipients: [
      { kind: 'ROLE', role: 'KSGP' },
      { kind: 'ROLE', role: 'S1C' },
    ],
    deepLink: transferCardLink,
    validatePayload: (raw) => {
      const record = asRecord(raw, 'EV-04');
      const issues: string[] = [];
      const payload: Event04Payload = {
        transferId: requireString(record, 'transferId', issues),
        sourceWarehouse: requireWarehouse(record, 'sourceWarehouse', issues),
        destinationWarehouse: requireWarehouse(record, 'destinationWarehouse', issues),
        linesCount: requireNumber(record, 'linesCount', issues),
      };
      failIfIssues('EV-04', issues);
      return payload;
    },
  },

  'EV-05': {
    code: 'EV-05',
    dbCode: 'EV_05',
    name: 'Перемещение принято (без расхождения)',
    title: 'Перемещение принято без расхождений',
    recipients: [{ kind: 'ROLE', role: 'S1C' }],
    deepLink: transferCardLink,
    validatePayload: (raw) => {
      const record = asRecord(raw, 'EV-05');
      const issues: string[] = [];
      const payload: Event05Payload = {
        transferId: requireString(record, 'transferId', issues),
        sourceWarehouse: requireWarehouse(record, 'sourceWarehouse', issues),
        destinationWarehouse: requireWarehouse(record, 'destinationWarehouse', issues),
      };
      failIfIssues('EV-05', issues);
      return payload;
    },
  },

  'EV-06': {
    code: 'EV-06',
    dbCode: 'EV_06',
    name: 'Расхождение обнаружено',
    title: 'Расхождение обнаружено',
    recipients: [{ kind: 'ROLE', role: 'NP' }],
    deepLink: transferCardLink,
    validatePayload: (raw) => {
      const record = asRecord(raw, 'EV-06');
      const issues: string[] = [];
      const payload: Event06Payload = {
        transferId: requireString(record, 'transferId', issues),
        sourceWarehouse: requireWarehouse(record, 'sourceWarehouse', issues),
        destinationWarehouse: requireWarehouse(record, 'destinationWarehouse', issues),
        discrepanciesCount: requireNumber(record, 'discrepanciesCount', issues),
      };
      failIfIssues('EV-06', issues);
      return payload;
    },
  },

  'EV-07': {
    code: 'EV-07',
    dbCode: 'EV_07',
    name: 'Расхождение согласовано',
    title: 'Расхождение согласовано',
    recipients: [
      { kind: 'ROLE', role: 'S1C' },
      { kind: 'ROLE', role: 'USGP' },
    ],
    deepLink: transferCardLink,
    validatePayload: (raw) => {
      const record = asRecord(raw, 'EV-07');
      const issues: string[] = [];
      const payload: Event07Payload = {
        transferId: requireString(record, 'transferId', issues),
        discrepanciesCount: requireNumber(record, 'discrepanciesCount', issues),
        reconciledByUserId: requireString(record, 'reconciledByUserId', issues),
      };
      failIfIssues('EV-07', issues);
      return payload;
    },
  },

  'EV-08': {
    code: 'EV-08',
    dbCode: 'EV_08',
    name: 'Смена закрыта за Оператора',
    title: 'Смена закрыта за Оператора',
    recipients: [{ kind: 'LINE_OPERATOR' }, { kind: 'ROLE', role: 'S1C' }],
    deepLink: orderCardLink,
    validatePayload: (raw) => {
      const record = asRecord(raw, 'EV-08');
      const issues: string[] = [];
      const payload: Event08Payload = {
        orderId: requireString(record, 'orderId', issues),
        lineId: requireString(record, 'lineId', issues),
        operatorId: requireString(record, 'operatorId', issues),
        reasonCode: requireOneOf(
          record,
          'reasonCode',
          SUBSTITUTION_REASON_CODES,
          issues,
          'причина из пресета',
        ) as Event08Payload['reasonCode'],
        comment: requireString(record, 'comment', issues, 'комментарий'),
        factIds: requireStringArray(record, 'factIds', issues),
      };
      failIfIssues('EV-08', issues);
      return payload;
    },
  },

  'EV-09': {
    code: 'EV-09',
    dbCode: 'EV_09',
    name: 'ПЗ отменено',
    title: 'ПЗ отменено',
    recipients: [{ kind: 'ORDER_OPERATORS' }],
    deepLink: orderCardLink,
    validatePayload: (raw) => {
      const record = asRecord(raw, 'EV-09');
      const issues: string[] = [];
      const payload: Event09Payload = {
        orderId: requireString(record, 'orderId', issues),
        reason: requireString(record, 'reason', issues),
        cancelledAt: requireString(record, 'cancelledAt', issues),
        cancelledByUserId: requireString(record, 'cancelledByUserId', issues),
      };
      failIfIssues('EV-09', issues);
      return payload;
    },
  },

  'EV-10': {
    code: 'EV-10',
    dbCode: 'EV_10',
    name: 'Перемещение отменено',
    title: 'Перемещение отменено',
    recipients: [
      { kind: 'ROLE', role: 'KSGP' },
      { kind: 'ROLE', role: 'S1C' },
    ],
    deepLink: transferCardLink,
    validatePayload: (raw) => {
      const record = asRecord(raw, 'EV-10');
      const issues: string[] = [];
      const payload: Event10Payload = {
        transferId: requireString(record, 'transferId', issues),
        sourceWarehouse: requireWarehouse(record, 'sourceWarehouse', issues),
        destinationWarehouse: requireWarehouse(record, 'destinationWarehouse', issues),
        status: requireOneOf(
          record,
          'status',
          ['CANCELLED'],
          issues,
          'признак отмены',
        ) as Event10Payload['status'],
      };
      failIfIssues('EV-10', issues);
      return payload;
    },
  },
};

/** Возвращает определение события по коду спека. */
export function getEventDefinition<K extends EventCodeValue>(
  code: K,
): NotificationEventDefinition<K> {
  const definition = EVENT_CATALOG[code];
  if (!definition) {
    throw new EventPayloadError(code, ['неизвестный код события']);
  }
  return definition;
}

/** Возвращает определение события по коду Prisma-энума ('EV_01'). */
export function getEventDefinitionByDbCode(
  dbCode: string,
): NotificationEventDefinition | undefined {
  return Object.values(EVENT_CATALOG).find(
    (definition) => definition.dbCode === dbCode,
  ) as NotificationEventDefinition | undefined;
}

/** Преобразует код Prisma-энума ('EV_01') в код спека ('EV-01'). */
export function dbCodeToEventCode(dbCode: string): EventCodeValue | undefined {
  return getEventDefinitionByDbCode(dbCode)?.code;
}
