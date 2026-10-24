import { describe, it, expect, vi } from 'vitest';
import type { NotificationScope } from '@prisma/client';
import type { TxClient } from '@prodtrack/db';
import {
  buildNotification,
  eventTitleByDbCode,
  notifyEvent,
  notificationScopesForCategory,
  resolveRecipients,
} from '../notify';

interface TxOverrides {
  roleUsers?: { id: string; scope?: NotificationScope; roleCodes?: string[] }[];
  operatorUsers?: { id: string }[];
  lineOperatorUser?: { id: string } | null;
  orderLines?: { operatorId: string | null }[];
}

function buildTx(overrides: TxOverrides = {}) {
  const findMany = vi.fn().mockImplementation((args: { where?: Record<string, unknown> }) => {
    const where = args.where ?? {};
    if ('employeeId' in where) {
      return Promise.resolve(overrides.operatorUsers ?? []);
    }
    // Мок воспроизводит запрос резолвера: роли по коду и фильтр направления уведомлений С1С.
    const code = (where.roles as { some?: { role?: { code?: string | { in?: string[] } } } } | undefined)
      ?.some?.role?.code;
    const roleCodes = typeof code === 'string' ? [code] : (code?.in ?? []);
    const scopeFilter = (where.notificationScope as { in?: string[] } | undefined)?.in;

    return Promise.resolve(
      (overrides.roleUsers ?? [])
        .filter((user) => {
          const userRoleCodes = user.roleCodes ?? ['S1C'];
          if (!roleCodes.some((roleCode) => userRoleCodes.includes(roleCode))) {
            return false;
          }
          return !scopeFilter || scopeFilter.includes(user.scope ?? 'ALL');
        })
        .map((user) => ({ id: user.id })),
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

  // ОПЭ-42: адресат — роль принимающего склада (передаётся в контексте), плюс С1С.
  it('EV-04 адресует уведомление роли принимающего склада и С1С', async () => {
    const { tx, findMany } = buildTx({
      roleUsers: [
        { id: 'ksgp-1', roleCodes: ['KSGP'] },
        { id: 's1c-1', roleCodes: ['S1C'] },
      ],
    });

    const ids = await resolveRecipients(tx, 'EV-04', transferPayload, { receivingRole: 'KSGP' });

    expect(ids).toEqual(['ksgp-1', 's1c-1']);
    // Роли, кроме С1С, разрешаются одним запросом; С1С — вторым, с фильтром направления.
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany.mock.calls[0][0]).toMatchObject({
      where: { roles: { some: { role: { code: { in: ['KSGP'] } } } } },
    });
    expect(findMany.mock.calls[1][0]).toMatchObject({
      where: {
        roles: { some: { role: { code: 'S1C' } } },
        notificationScope: { in: ['ALL', 'GP_TRANSFERS'] },
      },
    });
  });

  // Решение владельца 24.10.2026: адресат — С1С и представитель склада-приёмника
  // (УСГП для производственного, КСГП для склада ГП).
  it('EV-07 адресует уведомление С1С и роли склада-приёмника', async () => {
    const { tx, findMany } = buildTx({
      roleUsers: [
        { id: 's1c-1', roleCodes: ['S1C'] },
        { id: 'usgp-1', roleCodes: ['USGP'] },
      ],
    });

    const ids = await resolveRecipients(
      tx,
      'EV-07',
      { transferId: 'tr-1', discrepanciesCount: 2, reconciledByUserId: 'user-1' },
      { receivingRole: 'USGP' },
    );

    expect(ids).toEqual(['usgp-1', 's1c-1']);
    expect(findMany.mock.calls[0][0]).toMatchObject({
      where: { roles: { some: { role: { code: { in: ['USGP'] } } } } },
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

  it('направление «Масса» получает только события с Массой (ОПЭ, 13.10.2026)', async () => {
    const { tx } = buildTx({
      roleUsers: [
        { id: 's1c-mass', scope: 'MASS' },
        { id: 's1c-other', scope: 'GP_TRANSFERS' },
        { id: 's1c-all', scope: 'ALL' },
      ],
    });

    const ids = await resolveRecipients(
      tx,
      'EV-03',
      { orderId: 'po-1', lineId: 'line-1', factIds: ['fact-1'] },
      { productCategory: 'MASS' },
    );

    expect(ids).toEqual(['s1c-mass', 's1c-all']);
  });

  it('направление «ГП и перемещения» не получает события с Массой', async () => {
    const { tx } = buildTx({
      roleUsers: [
        { id: 's1c-mass', scope: 'MASS' },
        { id: 's1c-other', scope: 'GP_TRANSFERS' },
      ],
    });

    const ids = await resolveRecipients(
      tx,
      'EV-03',
      { orderId: 'po-1', lineId: 'line-1', factIds: ['fact-1'] },
      { productCategory: 'GP' },
    );

    expect(ids).toEqual(['s1c-other']);
  });

  it('уведомления о перемещениях идут только направлению «ГП и перемещения»', async () => {
    const { tx } = buildTx({
      roleUsers: [
        { id: 's1c-mass', scope: 'MASS' },
        { id: 's1c-other', scope: 'GP_TRANSFERS' },
        { id: 's1c-all', scope: 'ALL' },
      ],
    });

    // У событий перемещения категория продукции не передаётся — это направление «ГП и перемещения».
    const ids = await resolveRecipients(tx, 'EV-04', transferPayload);

    expect(ids).toEqual(['s1c-other', 's1c-all']);
  });

  it('настройка направления не влияет на другие роли пользователя', async () => {
    const { tx } = buildTx({
      roleUsers: [{ id: 'ksgp-s1c', scope: 'MASS', roleCodes: ['KSGP', 'S1C'] }],
    });

    // Событие адресовано принимающей роли (КСГП) и С1С: как КСГП пользователь получает его
    // независимо от своей настройки направления (ОПЭ-42).
    const ids = await resolveRecipients(tx, 'EV-04', transferPayload, { receivingRole: 'KSGP' });

    expect(ids).toEqual(['ksgp-s1c']);
  });

  it('направления уведомлений по категории события', () => {
    expect(notificationScopesForCategory('MASS')).toEqual(['ALL', 'MASS']);
    expect(notificationScopesForCategory('GP')).toEqual(['ALL', 'GP_TRANSFERS']);
    // У событий перемещения категории нет — их получает направление «ГП и перемещения».
    expect(notificationScopesForCategory(undefined)).toEqual(['ALL', 'GP_TRANSFERS']);
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
