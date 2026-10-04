import { describe, it, expect } from 'vitest';
import { EVENT_CODES, SUBSTITUTION_REASONS } from './index';
import {
  EVENT_CATALOG,
  EventPayloadError,
  SUBSTITUTION_REASON_CODES,
  dbCodeToEventCode,
  getEventDefinition,
  getEventDefinitionByDbCode,
  type Event08Payload,
} from './events';

const ALL_CODES = EVENT_CODES as readonly string[];

describe('каталог событий M09 (00 §5, M09 §7)', () => {
  it('содержит все 10 событий каталога', () => {
    expect(Object.keys(EVENT_CATALOG)).toHaveLength(10);
    expect(Object.keys(EVENT_CATALOG).sort()).toEqual([...ALL_CODES].sort());
  });

  it('для каждого события задан dbCode в форме Prisma-энума', () => {
    for (const definition of Object.values(EVENT_CATALOG)) {
      expect(definition.dbCode).toBe(definition.code.replace('-', '_'));
      expect(definition.dbCode).toMatch(/^EV_\d{2}$/);
    }
  });

  it('названия событий соответствуют каталогу 00 §5', () => {
    const names = Object.fromEntries(
      Object.values(EVENT_CATALOG).map((definition) => [definition.code, definition.name]),
    );
    expect(names).toEqual({
      'EV-01': 'ПЗ подтверждено',
      'EV-02': 'Получение ПЗ подтверждено',
      'EV-03': 'Итог смены внесён',
      'EV-04': 'Перемещение отправлено',
      'EV-05': 'Перемещение принято (без расхождения)',
      'EV-06': 'Расхождение обнаружено',
      'EV-07': 'Расхождение согласовано',
      'EV-08': 'Смена закрыта за Оператора',
      'EV-09': 'ПЗ отменено',
      'EV-10': 'Перемещение отменено',
    });
  });

  it('у каждого события есть адресаты, заголовок и deep-link', () => {
    for (const definition of Object.values(EVENT_CATALOG)) {
      expect(definition.recipients.length).toBeGreaterThan(0);
      expect(definition.title.length).toBeGreaterThan(0);
      expect(typeof definition.deepLink).toBe('function');
    }
  });

  it('адресаты соответствуют каталогу 00 §5', () => {
    expect(EVENT_CATALOG['EV-01'].recipients).toEqual([{ kind: 'ORDER_OPERATORS' }]);
    expect(EVENT_CATALOG['EV-02'].recipients).toEqual([{ kind: 'ROLE', role: 'NP' }]);
    expect(EVENT_CATALOG['EV-03'].recipients).toEqual([{ kind: 'ROLE', role: 'S1C' }]);
    expect(EVENT_CATALOG['EV-04'].recipients).toEqual([
      { kind: 'ROLE', role: 'KSGP' },
      { kind: 'ROLE', role: 'S1C' },
    ]);
    expect(EVENT_CATALOG['EV-05'].recipients).toEqual([{ kind: 'ROLE', role: 'S1C' }]);
    expect(EVENT_CATALOG['EV-06'].recipients).toEqual([{ kind: 'ROLE', role: 'NP' }]);
    expect(EVENT_CATALOG['EV-07'].recipients).toEqual([
      { kind: 'ROLE', role: 'S1C' },
      { kind: 'ROLE', role: 'USGP' },
    ]);
    expect(EVENT_CATALOG['EV-08'].recipients).toEqual([
      { kind: 'LINE_OPERATOR' },
      { kind: 'ROLE', role: 'S1C' },
    ]);
    expect(EVENT_CATALOG['EV-09'].recipients).toEqual([{ kind: 'ORDER_OPERATORS' }]);
    expect(EVENT_CATALOG['EV-10'].recipients).toEqual([
      { kind: 'ROLE', role: 'KSGP' },
      { kind: 'ROLE', role: 'S1C' },
    ]);
  });

  it('пресет причин Р-13 совпадает со справочником SubstitutionReason', () => {
    expect([...SUBSTITUTION_REASON_CODES].sort()).toEqual(
      [...SUBSTITUTION_REASONS].sort(),
    );
  });

  it('deep-link ведёт в целевой объект', () => {
    expect(EVENT_CATALOG['EV-01'].deepLink({ orderId: 'po-1' } as never)).toBe(
      '/production-orders/po-1',
    );
    // EV-02 ведёт на строку РЦ (M09 §7), без строки в payload — на карточку ПЗ.
    expect(
      EVENT_CATALOG['EV-02'].deepLink({ orderId: 'po-2', lineId: 'line-9' } as never),
    ).toBe('/production-orders/po-2#line-line-9');
    expect(EVENT_CATALOG['EV-02'].deepLink({ orderId: 'po-2' } as never)).toBe(
      '/production-orders/po-2',
    );
    expect(EVENT_CATALOG['EV-04'].deepLink({ transferId: 'tr-1' } as never)).toBe('/transfers/tr-1');
    expect(EVENT_CATALOG['EV-06'].deepLink({ transferId: 'tr-2' } as never)).toBe('/transfers/tr-2');
    expect(EVENT_CATALOG['EV-09'].deepLink({ orderId: 'po-3' } as never)).toBe(
      '/production-orders/po-3',
    );
    expect(
      EVENT_CATALOG['EV-08'].deepLink({ orderId: 'po-3', lineId: 'line-7' } as never),
    ).toBe('/production-orders/po-3#line-line-7');
    expect(EVENT_CATALOG['EV-10'].deepLink({ transferId: 'tr-3' } as never)).toBe('/transfers/tr-3');
  });
});

describe('валидация payload', () => {
  it('EV-08 принимает причину из пресета и непустой комментарий (Р-13)', () => {
    const payload = EVENT_CATALOG['EV-08'].validatePayload({
      orderId: 'po-1',
      lineId: 'line-1',
      operatorId: 'emp-1',
      reasonCode: 'ILLNESS',
      comment: 'Оператор на больничном',
      factIds: ['fact-1', 'fact-2'],
    });
    expect(payload).toEqual<Event08Payload>({
      orderId: 'po-1',
      lineId: 'line-1',
      operatorId: 'emp-1',
      reasonCode: 'ILLNESS',
      comment: 'Оператор на больничном',
      factIds: ['fact-1', 'fact-2'],
    });
  });

  it('EV-08 отклоняет причину вне пресета', () => {
    expect(() =>
      EVENT_CATALOG['EV-08'].validatePayload({
        orderId: 'po-1',
        lineId: 'line-1',
        operatorId: 'emp-1',
        reasonCode: 'VACATION',
        comment: 'Отпуск',
        factIds: [],
      }),
    ).toThrow(EventPayloadError);
  });

  it('EV-08 отклоняет отсутствующий и пустой комментарий', () => {
    const base = {
      orderId: 'po-1',
      lineId: 'line-1',
      operatorId: 'emp-1',
      reasonCode: 'NO_SHOW',
      factIds: [],
    };
    expect(() => EVENT_CATALOG['EV-08'].validatePayload({ ...base })).toThrow(/комментарий|comment/);
    expect(() =>
      EVENT_CATALOG['EV-08'].validatePayload({ ...base, comment: '   ' }),
    ).toThrow(/комментарий|comment/);
  });

  it('EV-08 отклоняет не-объект', () => {
    expect(() => EVENT_CATALOG['EV-08'].validatePayload(null)).toThrow(EventPayloadError);
    expect(() => EVENT_CATALOG['EV-08'].validatePayload('payload')).toThrow(EventPayloadError);
  });

  it('EV-04 проверяет обязательные поля и склады', () => {
    expect(() => EVENT_CATALOG['EV-04'].validatePayload({ transferId: 'tr-1' })).toThrow(
      EventPayloadError,
    );

    const payload = EVENT_CATALOG['EV-04'].validatePayload({
      transferId: 'tr-1',
      sourceWarehouse: { id: 'wh-1', name: 'Производственный склад' },
      destinationWarehouse: { id: 'wh-2', name: 'Склад ГП' },
      linesCount: 3,
    });
    expect(payload).toMatchObject({ transferId: 'tr-1', linesCount: 3 });
  });

  it('EV-10 требует признак отмены', () => {
    const base = {
      transferId: 'tr-1',
      sourceWarehouse: { id: 'wh-1', name: 'Производственный склад' },
      destinationWarehouse: { id: 'wh-2', name: 'Склад ГП' },
    };
    expect(() => EVENT_CATALOG['EV-10'].validatePayload({ ...base, status: 'RECEIVED' })).toThrow(
      EventPayloadError,
    );
    expect(EVENT_CATALOG['EV-10'].validatePayload({ ...base, status: 'CANCELLED' }).status).toBe(
      'CANCELLED',
    );
  });

  it('каждое событие отклоняет пустой payload', () => {
    for (const definition of Object.values(EVENT_CATALOG)) {
      expect(() => definition.validatePayload({})).toThrow(EventPayloadError);
    }
  });

  it('сообщение об ошибке содержит код события и перечень проблем', () => {
    try {
      EVENT_CATALOG['EV-01'].validatePayload({ orderId: 'po-1' });
      throw new Error('ожидалась ошибка валидации');
    } catch (error) {
      expect(error).toBeInstanceOf(EventPayloadError);
      const payloadError = error as EventPayloadError;
      expect(payloadError.code).toBe('EV-01');
      expect(payloadError.issues.length).toBeGreaterThan(0);
      expect(payloadError.message).toContain('EV-01');
    }
  });
});

describe('доступ к каталогу', () => {
  it('getEventDefinition возвращает определение по коду спека', () => {
    expect(getEventDefinition('EV-05').dbCode).toBe('EV_05');
  });

  it('getEventDefinitionByDbCode находит событие по коду Prisma-энума', () => {
    expect(getEventDefinitionByDbCode('EV_07')?.code).toBe('EV-07');
    expect(getEventDefinitionByDbCode('EV_99')).toBeUndefined();
  });

  it('dbCodeToEventCode переводит форму энума в форму спека', () => {
    expect(dbCodeToEventCode('EV_10')).toBe('EV-10');
    expect(dbCodeToEventCode('unknown')).toBeUndefined();
  });
});
