import { describe, it, expect } from 'vitest';
import {
  describeNotification,
  NOTIFICATION_FILTERS,
  parseNotificationBody,
  type NotificationItem,
} from '../labels';

function item(partial: Partial<NotificationItem>): NotificationItem {
  return {
    id: 'n-1',
    eventCode: 'EV_01',
    title: 'Событие',
    body: null,
    deepLink: '/production-orders/po-1',
    readAt: null,
    createdAt: '2026-10-03T10:00:00.000Z',
    ...partial,
  };
}

describe('фильтры центра уведомлений (M09 §8)', () => {
  it('содержит все/непрочитанные/прочитанные', () => {
    expect(NOTIFICATION_FILTERS.map((f) => f.value)).toEqual(['ALL', 'UNREAD', 'READ']);
    expect(NOTIFICATION_FILTERS.map((f) => f.label)).toEqual([
      'Все',
      'Непрочитанные',
      'Прочитанные',
    ]);
  });
});

describe('parseNotificationBody', () => {
  it('разбирает JSON-payload', () => {
    expect(parseNotificationBody('{"orderId":"po-1"}')).toEqual({ orderId: 'po-1' });
  });

  it('возвращает null для пустого и некорректного payload', () => {
    expect(parseNotificationBody(null)).toBeNull();
    expect(parseNotificationBody('не json')).toBeNull();
    expect(parseNotificationBody('[1,2]')).toBeNull();
  });
});

describe('describeNotification', () => {
  it('EV-08 показывает причину и комментарий (Р-13)', () => {
    const text = describeNotification(
      item({
        eventCode: 'EV_08',
        body: JSON.stringify({ reasonCode: 'ILLNESS', comment: 'Больничный лист' }),
      }),
    );
    expect(text).toBe('Причина: Болезнь — Больничный лист');
  });

  it('EV-04 показывает маршрут складов', () => {
    const text = describeNotification(
      item({
        eventCode: 'EV_04',
        body: JSON.stringify({
          sourceWarehouse: { id: 'wh-1', name: 'Производственный склад' },
          destinationWarehouse: { id: 'wh-2', name: 'Склад ГП' },
        }),
      }),
    );
    expect(text).toBe('Производственный склад → Склад ГП');
  });

  it('EV-06 добавляет количество расхождений', () => {
    const text = describeNotification(
      item({
        eventCode: 'EV_06',
        body: JSON.stringify({
          sourceWarehouse: { id: 'wh-1', name: 'Производственный склад' },
          destinationWarehouse: { id: 'wh-2', name: 'Склад ГП' },
          discrepanciesCount: 2,
        }),
      }),
    );
    expect(text).toBe('Производственный склад → Склад ГП, расхождений: 2');
  });

  it('EV-09 показывает причину отмены', () => {
    const text = describeNotification(
      item({ eventCode: 'EV_09', body: JSON.stringify({ reason: 'Ремонт РЦ' }) }),
    );
    expect(text).toBe('Причина отмены: Ремонт РЦ');
  });

  it('EV-01 показывает смену и число строк', () => {
    const text = describeNotification(
      item({ eventCode: 'EV_01', body: JSON.stringify({ shiftName: 'Смена 1', linesCount: 3 }) }),
    );
    expect(text).toBe('Смена 1, строк: 3');
  });

  it('для неизвестного payload отдаёт название события из каталога', () => {
    expect(describeNotification(item({ eventCode: 'EV_03', body: null }))).toBe(
      'Итог смены готов к передаче в 1С',
    );
  });
});
