import { describe, it, expect, vi } from 'vitest';
import type { TxClient } from '@prodtrack/db';
import { buildNotification, eventTitleByDbCode, notifyEvent, resolveRecipients } from '../notify';

interface TxOverrides {
  roleUsers?: { id: string }[];
  operatorUsers?: { id: string }[];
  lineOperatorUser?: { id: string } | null;
  orderLines?: { operatorId: string | null }[];
}

function buildTx(overrides: TxOverrides = {}) {
  const findMany = vi.fn().mockImplementation((args: { where?: Record<string, unknown> }) => {
    const where = args.where ?? {};
    return Promise.resolve(
      'employeeId' in where ? (overrides.operatorUsers ?? []) : (overrides.roleUsers ?? []),
    );
  });
  const findFirst = vi.fn().mockResolvedValue(overrides.lineOperatorUser ?? null);
  const lineFindMany = vi.fn().mockResolvedValue(overrides.orderLines ?? []);

  return {
    tx: {
      user: { findMany, findFirst },
      productionOrderLine: { findMany: lineFindMany },
    } as unknown as TxClient,
    findMany,
    findFirst,
    lineFindMany,
  };
}

const transferPayload = {
  transferId: 'tr-1',
  sourceWarehouse: { id: 'wh-1', name: 'Производственный склад' },
  destinationWarehouse: { id: 'wh-2', name: 'Склад ГП' },
  linesCount: 2,
};

describe('resolveRecipients — адресация по каталогу (M09 BR-3)', () => {
  it('EV-01 адресует уведомление операторам назначенных РЦ', async () => {
    const { tx, findMany } = buildTx({ operatorUsers: [{ id: 'user-opr-1' }, { id: 'user-opr-2' }] });

    const ids = await resolveRecipients(
      tx,
      'EV-01',
      { orderId: 'po-1', shiftId: 'shift-1', linesCount: 2 },
      { operatorEmployeeIds: ['emp-1', 'emp-2'] },
    );

    expect(ids).toEqual(['user-opr-1', 'user-opr-2']);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0]).toMatchObject({
      where: { employeeId: { in: ['emp-1', 'emp-2'] } },
    });
  });

  it('EV-04 адресует уведомление КСГП и С1С одним запросом (00 §5)', async () => {
    const { tx, findMany } = buildTx({ roleUsers: [{ id: 'ksgp-1' }, { id: 's1c-1' }] });

    const ids = await resolveRecipients(tx, 'EV-04', transferPayload);

    expect(ids).toEqual(['ksgp-1', 's1c-1']);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0]).toMatchObject({
      where: { roles: { some: { role: { code: { in: ['KSGP', 'S1C'] } } } } },
    });
  });

  it('EV-07 адресует уведомление С1С и УСГП (00 §5)', async () => {
    const { tx, findMany } = buildTx({ roleUsers: [{ id: 's1c-1' }, { id: 'usgp-1' }] });

    await resolveRecipients(tx, 'EV-07', {
      transferId: 'tr-1',
      discrepanciesCount: 2,
      reconciledByUserId: 'user-1',
    });

    expect(findMany.mock.calls[0][0]).toMatchObject({
      where: { roles: { some: { role: { code: { in: ['S1C', 'USGP'] } } } } },
    });
  });

  it('EV-08 адресует уведомление оператору строки и С1С', async () => {
    const { tx, findFirst, findMany } = buildTx({
      lineOperatorUser: { id: 'user-opr-1' },
      roleUsers: [{ id: 's1c-1' }],
    });

    const ids = await resolveRecipients(tx, 'EV-08', {
      orderId: 'po-1',
      lineId: 'line-1',
      operatorId: 'emp-1',
      reasonCode: 'ILLNESS',
      comment: 'Больничный',
      factIds: [],
    });

    expect(ids).toEqual(['s1c-1', 'user-opr-1']);
    expect(findFirst).toHaveBeenCalledWith({ where: { employeeId: 'emp-1' }, select: { id: true } });
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('не дублирует получателя, если он подходит под два правила', async () => {
    const { tx } = buildTx({
      lineOperatorUser: { id: 'user-duplicate' },
      roleUsers: [{ id: 'user-duplicate' }],
    });

    const ids = await resolveRecipients(tx, 'EV-08', {
      orderId: 'po-1',
      lineId: 'line-1',
      operatorId: 'emp-1',
      reasonCode: 'OTHER',
      comment: 'Иное',
      factIds: [],
    });

    expect(ids).toEqual(['user-duplicate']);
  });

  it('правило ORDER_OPERATORS без контекста берёт операторов из строк ПЗ', async () => {
    const { tx, lineFindMany } = buildTx({
      orderLines: [{ operatorId: 'emp-1' }, { operatorId: 'emp-1' }, { operatorId: null }],
      operatorUsers: [{ id: 'user-opr-1' }],
    });

    const ids = await resolveRecipients(tx, 'EV-09', {
      orderId: 'po-1',
      reason: 'Ремонт РЦ',
      cancelledAt: new Date().toISOString(),
      cancelledByUserId: 'user-1',
    });

    expect(ids).toEqual(['user-opr-1']);
    expect(lineFindMany).toHaveBeenCalledTimes(1);
  });
});

describe('notifyEvent — валидация и запись', () => {
  it('пишет уведомление по данным каталога', async () => {
    const { tx } = buildTx({ roleUsers: [{ id: 's1c-1' }] });
    const emit = vi.fn().mockResolvedValue(undefined);

    const result = await notifyEvent(tx, 'EV-05', {
      transferId: 'tr-1',
      sourceWarehouse: { id: 'wh-1', name: 'Производственный склад' },
      destinationWarehouse: { id: 'wh-2', name: 'Склад ГП' },
    }, { emit });

    expect(result.recipientIds).toEqual(['s1c-1']);
    expect(emit).toHaveBeenCalledTimes(1);
    const [emitTx, notification] = emit.mock.calls[0];
    expect(emitTx).toBe(tx);
    expect(notification.eventCode).toBe('EV_05');
    expect(notification.title).toBe('Перемещение принято без расхождений');
    expect(notification.deepLink).toBe('/transfers/tr-1');
    expect(notification.recipientIds).toEqual(['s1c-1']);
  });

  it('не пишет уведомление при пустом списке получателей', async () => {
    const { tx } = buildTx();
    const emit = vi.fn();

    const result = await notifyEvent(tx, 'EV-04', transferPayload, { emit });

    expect(result.recipientIds).toEqual([]);
    expect(emit).not.toHaveBeenCalled();
  });

  it('отклоняет EV-08 без комментария и не пишет уведомление (Р-13)', async () => {
    const { tx } = buildTx({ lineOperatorUser: { id: 'user-opr-1' } });
    const emit = vi.fn();

    await expect(
      notifyEvent(tx, 'EV-08', {
        orderId: 'po-1',
        lineId: 'line-1',
        operatorId: 'emp-1',
        reasonCode: 'NO_SHOW',
        factIds: [],
      }, { emit }),
    ).rejects.toThrow(/комментарий/);

    expect(emit).not.toHaveBeenCalled();
  });

  it('отклоняет EV-08 с причиной вне пресета', async () => {
    const { tx } = buildTx({ lineOperatorUser: { id: 'user-opr-1' } });

    await expect(
      notifyEvent(tx, 'EV-08', {
        orderId: 'po-1',
        lineId: 'line-1',
        operatorId: 'emp-1',
        reasonCode: 'VACATION',
        comment: 'Отпуск',
        factIds: [],
      }),
    ).rejects.toThrow(/reasonCode/);
  });
});

describe('buildNotification', () => {
  it('формирует тело и payload из провалидированных данных', () => {
    const notification = buildNotification('EV-04', transferPayload, ['ksgp-1']);

    expect(notification.eventCode).toBe('EV_04');
    expect(notification.body).toBe(JSON.stringify(transferPayload));
    expect(notification.payload).toEqual(transferPayload);
    expect(notification.deepLink).toBe('/transfers/tr-1');
  });

  it('eventTitleByDbCode возвращает заголовок по коду энума', () => {
    expect(eventTitleByDbCode('EV_06')).toBe('Расхождение обнаружено');
    expect(eventTitleByDbCode('EV_99')).toBeUndefined();
  });
});
