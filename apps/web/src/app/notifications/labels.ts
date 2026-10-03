// Чистые хелперы и типы экрана «Уведомления» (M09 §8).
//
// Обычный модуль без 'use server' и без 'use client': используется и серверной
// страницей, и клиентским списком (урок Фазы 3 — хелперы не держать
// в 'use server'-файлах и не превращать их в Server Reference).

import { EVENT_CATALOG, dbCodeToEventCode, SubstitutionReason } from '@prodtrack/contracts';

export type NotificationFilter = 'ALL' | 'UNREAD' | 'READ';

export interface NotificationItem {
  id: string;
  eventCode: string;
  title: string;
  body: string | null;
  deepLink: string | null;
  readAt: string | null;
  createdAt: string;
}

export const NOTIFICATION_FILTERS: Array<{ value: NotificationFilter; label: string }> = [
  { value: 'ALL', label: 'Все' },
  { value: 'UNREAD', label: 'Непрочитанные' },
  { value: 'READ', label: 'Прочитанные' },
];

const REASON_LABELS: Record<string, string> = {
  [SubstitutionReason.ILLNESS]: 'Болезнь',
  [SubstitutionReason.NO_SHOW]: 'Неявка',
  [SubstitutionReason.LEFT_SHIFT]: 'Ушёл со смены',
  [SubstitutionReason.OTHER]: 'Иное',
};

/** Разбирает JSON-payload уведомления; при некорректном значении возвращает null. */
export function parseNotificationBody(body: string | null): Record<string, unknown> | null {
  if (!body) {
    return null;
  }
  try {
    const parsed = JSON.parse(body) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function warehousePair(payload: Record<string, unknown>): string | null {
  const source = payload.sourceWarehouse as { name?: string } | undefined;
  const destination = payload.destinationWarehouse as { name?: string } | undefined;
  if (!source?.name || !destination?.name) {
    return null;
  }
  return source.name + ' → ' + destination.name;
}

/** Человекочитаемая краткая суть уведомления (M09 §8: заголовок, текст, время). */
export function describeNotification(item: NotificationItem): string {
  const specCode = dbCodeToEventCode(item.eventCode);
  const payload = parseNotificationBody(item.body) ?? {};

  switch (specCode) {
    case 'EV-01':
      return [payload.shiftName, payload.linesCount ? 'строк: ' + String(payload.linesCount) : null]
        .filter(Boolean)
        .join(', ');
    case 'EV-02':
      return 'Подтверждено получение по строке РЦ';
    case 'EV-03':
      return 'Итог смены готов к передаче в 1С';
    case 'EV-04':
    case 'EV-05':
    case 'EV-10': {
      return warehousePair(payload) ?? 'Карточка перемещения';
    }
    case 'EV-06':
    case 'EV-07': {
      const pair = warehousePair(payload);
      const count = payload.discrepanciesCount;
      const suffix = typeof count === 'number' ? 'расхождений: ' + count : null;
      return [pair, suffix].filter(Boolean).join(', ') || 'Карточка перемещения';
    }
    case 'EV-08': {
      const reason = typeof payload.reasonCode === 'string' ? REASON_LABELS[payload.reasonCode] : null;
      const comment = typeof payload.comment === 'string' ? payload.comment : null;
      return [reason ? 'Причина: ' + reason : null, comment].filter(Boolean).join(' — ');
    }
    case 'EV-09': {
      const reason = typeof payload.reason === 'string' ? payload.reason : null;
      return reason ? 'Причина отмены: ' + reason : 'Производственное задание отменено';
    }
    default: {
      const definition = (EVENT_CATALOG as Record<string, { name: string } | undefined>)[
        item.eventCode
      ];
      return definition?.name ?? 'Событие';
    }
  }
}
