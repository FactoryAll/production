// Диспетчер уведомлений M09 (T-044): единая точка эмиссии событий каталога.
//
// Модуль связывает три части:
//   1) каталог событий (`@prodtrack/contracts`, 00 §5 / M09 §7) — код, заголовок,
//      deep-link, правило адресации и валидация payload;
//   2) резолвер адресатов — превращает декларативное правило каталога в список
//      идентификаторов пользователей (M09 BR-3);
//   3) kernel-запись `emitEvent` (T-059) — фактическая вставка в `notifications`.
//
// Здесь нет директивы 'use server': модуль вызывается из серверных действий и
// должен оставаться обычным модулем (иначе синхронные хелперы становятся
// Server Reference и падают при рендере — урок Фазы 3).

import type { Prisma } from '@prisma/client';
import {
  EVENT_CATALOG,
  getEventDefinition,
  type EventCodeValue,
  type EventPayloads,
  type NotificationEventDefinition,
} from '@prodtrack/contracts';
import { emitEvent, type EmitEventInput, type TxClient } from '@prodtrack/db';

/** Данные, которые вызывающая сторона уже знает и может передать без лишних запросов. */
export interface RecipientContext {
  /** Табельные id операторов назначенных РЦ (правило ORDER_OPERATORS). */
  operatorEmployeeIds?: string[];
  /** Табельный id оператора строки РЦ (правило LINE_OPERATOR). */
  lineOperatorEmployeeId?: string;
}

export interface NotifyEventOptions {
  /** Контекст адресатов, если он уже известен вызывающей стороне. */
  context?: RecipientContext;
  /** Подмена записи (DI): по умолчанию — kernel `emitEvent`. */
  emit?: typeof emitEvent;
}

export interface NotifyEventResult {
  /** Построенное уведомление (payload уже провалидирован). */
  event: EmitEventInput;
  /** Получатели уведомления. */
  recipientIds: string[];
}

/** Собирает запись уведомления по определению каталога. */
function composeNotification<K extends EventCodeValue>(
  definition: NotificationEventDefinition<K>,
  payload: EventPayloads[K],
  recipientIds: string[],
): EmitEventInput {
  return {
    eventCode: definition.dbCode as EmitEventInput['eventCode'],
    title: definition.title,
    body: JSON.stringify(payload),
    deepLink: definition.deepLink(payload),
    payload: payload as unknown as Prisma.InputJsonValue,
    recipientIds,
  };
}

async function loadOrderOperatorEmployeeIds(
  tx: TxClient,
  payload: unknown,
): Promise<string[]> {
  const orderId = (payload as { orderId?: string }).orderId;
  if (!orderId) {
    return [];
  }
  const lines = await tx.productionOrderLine.findMany({
    where: { orderId },
    select: { operatorId: true },
  });
  return [
    ...new Set(lines.map((line) => line.operatorId).filter((id): id is string => Boolean(id))),
  ];
}

/**
 * Превращает правило адресации каталога в список получателей (M09 BR-3).
 * Роли разрешаются одним запросом; дубликаты пользователей устраняются.
 */
export async function resolveRecipients<K extends EventCodeValue>(
  tx: TxClient,
  code: K,
  payload: EventPayloads[K],
  context: RecipientContext = {},
): Promise<string[]> {
  const definition = getEventDefinition(code);
  const recipientIds = new Set<string>();

  const roleCodes = definition.recipients.flatMap((rule) =>
    rule.kind === 'ROLE' ? [rule.role] : [],
  );

  if (roleCodes.length > 0) {
    const users = await tx.user.findMany({
      where: { roles: { some: { role: { code: { in: roleCodes } } } } },
      select: { id: true },
    });
    for (const user of users) {
      recipientIds.add(user.id);
    }
  }

  if (definition.recipients.some((rule) => rule.kind === 'ORDER_OPERATORS')) {
    const employeeIds =
      context.operatorEmployeeIds ?? (await loadOrderOperatorEmployeeIds(tx, payload));
    if (employeeIds.length > 0) {
      const users = await tx.user.findMany({
        where: { employeeId: { in: employeeIds } },
        select: { id: true },
      });
      for (const user of users) {
        recipientIds.add(user.id);
      }
    }
  }

  if (definition.recipients.some((rule) => rule.kind === 'LINE_OPERATOR')) {
    const employeeId =
      context.lineOperatorEmployeeId ?? (payload as { operatorId?: string }).operatorId;
    if (employeeId) {
      const user = await tx.user.findFirst({
        where: { employeeId },
        select: { id: true },
      });
      if (user) {
        recipientIds.add(user.id);
      }
    }
  }

  return [...recipientIds];
}

/**
 * Валидирует payload и собирает уведомление по каталогу.
 * При некорректном payload выбрасывает `EventPayloadError` — защита от записи
 * события с неполными данными (в т.ч. EV-08 без причины и комментария, Р-13).
 */
export function buildNotification<K extends EventCodeValue>(
  code: K,
  rawPayload: unknown,
  recipientIds: string[],
): EmitEventInput {
  const definition = getEventDefinition(code);
  return composeNotification(definition, definition.validatePayload(rawPayload), recipientIds);
}

/**
 * Полный цикл M09: валидация payload → резолв адресатов по каталогу → запись уведомлений.
 * При пустом списке получателей запись не выполняется.
 */
export async function notifyEvent<K extends EventCodeValue>(
  tx: TxClient,
  code: K,
  rawPayload: unknown,
  options: NotifyEventOptions = {},
): Promise<NotifyEventResult> {
  const definition = getEventDefinition(code);
  const payload = definition.validatePayload(rawPayload);
  const recipientIds = await resolveRecipients(tx, code, payload, options.context ?? {});
  const notification = composeNotification(definition, payload, recipientIds);

  if (recipientIds.length === 0) {
    return { event: notification, recipientIds };
  }

  await (options.emit ?? emitEvent)(tx, notification);
  return { event: notification, recipientIds };
}

/** Заголовок уведомления по коду Prisma-энума — для read-side M09. */
export function eventTitleByDbCode(dbCode: string): string | undefined {
  return Object.values(EVENT_CATALOG).find(
    (definition) => definition.dbCode === dbCode,
  )?.title;
}
