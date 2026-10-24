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

import type { NotificationScope, Prisma } from '@prisma/client';
import type { RoleCodeValue } from '@prodtrack/contracts';
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
  /** Роль, принимающая на складе-приёмнике (ОПЭ-42): КСГП или УСГП. */
  receivingRole?: RoleCodeValue;
  /** Кого не уведомлять — например, автора действия (ОПЭ-42: «сам себе» не пишем). */
  excludeUserIds?: string[];
  /** Табельные id операторов назначенных РЦ (правило ORDER_OPERATORS). */
  operatorEmployeeIds?: string[];
  /** Табельный id оператора строки РЦ (правило LINE_OPERATOR). */
  lineOperatorEmployeeId?: string;
  /**
   * Категория продукции события — по ней фильтруются адресаты роли С1С.
   * Не задана у событий перемещения: там направление считается «ГП и перемещения».
   */
  productCategory?: 'MASS' | 'GP';
}

/**
 * Направление уведомлений специалиста 1С (фидбэк ОПЭ, 13.10.2026).
 *
 * Специалистов двое: один ведёт Массу, второй — ГП и перемещения. Фильтр применяется только
 * к адресатам роли С1С: у остальных ролей настройка ни на что не влияет.
 */
/**
 * Категория продукции для фильтра направления уведомлений С1С (ОПЭ, 13.10.2026):
 * факты Массы отличаются от всего остального (ГП и ПФ) — по этому признаку и разделены
 * два специалиста 1С.
 */
export function notificationCategoryOfFacts(
  facts: { factCategory: string }[],
): 'MASS' | 'GP' {
  return facts.some((fact) => fact.factCategory === 'MASS') ? 'MASS' : 'GP';
}

export function notificationScopesForCategory(
  productCategory?: 'MASS' | 'GP',
): NotificationScope[] {
  // Масса — специалисту по Массе; во всех остальных случаях (ГП и события перемещения,
  // у которых категории нет) — второму специалисту. «Все» получает и то, и другое.
  return productCategory === 'MASS' ? ['ALL', 'MASS'] : ['ALL', 'GP_TRANSFERS'];
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
    rule.kind === 'ROLE'
      ? [rule.role]
      : rule.kind === 'RECEIVING_ROLE' && context.receivingRole
        ? [context.receivingRole]
        : [],
  );

  // Роль С1С разбирается отдельно: у неё есть направление уведомлений (ОПЭ, 13.10.2026).
  // Раздельные запросы ещё и сохраняют простое правило: если событие адресовано и другой роли
  // пользователя (например, КСГП), он получит его независимо от своей настройки направления.
  const plainRoleCodes = roleCodes.filter((code) => code !== 'S1C');

  if (plainRoleCodes.length > 0) {
    const users = await tx.user.findMany({
      where: { roles: { some: { role: { code: { in: plainRoleCodes } } } } },
      select: { id: true },
    });
    for (const user of users) {
      recipientIds.add(user.id);
    }
  }

  if (roleCodes.includes('S1C')) {
    const s1cUsers = await tx.user.findMany({
      where: {
        roles: { some: { role: { code: 'S1C' } } },
        notificationScope: { in: notificationScopesForCategory(context.productCategory) },
      },
      select: { id: true },
    });
    for (const user of s1cUsers) {
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

  // ОПЭ-42: автор действия не уведомляется о собственном действии.
  const excluded = new Set(context.excludeUserIds ?? []);
  return [...recipientIds].filter((id) => !excluded.has(id));
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
