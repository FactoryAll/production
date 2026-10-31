/**
 * Системное уведомление на рабочем столе и переход по ссылке (уровень 1, 01.11.2026).
 *
 * Вынесено отдельным модулем, чтобы клик по уведомлению проверялся тестом: в jsdom навигация
 * не реализована, и без отделяемого вызова её нечем проверить.
 */

/**
 * Общий тег окна: все уведомления приложения занимают ОДНО системное окно (решение
 * 01.11.2026, см. `docs/notifications_desktop.md` §9). Новое событие заменяет предыдущее,
 * а не встаёт в стопку: с `requireInteraction` окна висят до действия пользователя, и
 * десяток событий превратился бы в десяток окон поверх работы.
 */
export const NOTIFICATION_TAG = 'prodtrack-notifications';

export interface DesktopNotificationInput {
  id: string;
  title: string;
  body: string | null;
  deepLink: string | null;
  /** Пользователь открыл уведомление (клик) — повод сбросить счётчик «и ещё N». */
  onOpen?: () => void;
}

/** Поддерживает ли браузер системные уведомления. */
export function desktopNotificationsSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.Notification !== 'undefined';
}

/** Текущее разрешение: 'default' | 'granted' | 'denied' | 'unsupported'. */
export function notificationPermission(): 'default' | 'granted' | 'denied' | 'unsupported' {
  if (!desktopNotificationsSupported()) {
    return 'unsupported';
  }
  return window.Notification.permission;
}

/** Просьба о разрешении — вызывается ТОЛЬКО по действию пользователя, не на загрузке. */
export async function requestNotificationPermission(): Promise<'default' | 'granted' | 'denied' | 'unsupported'> {
  if (!desktopNotificationsSupported()) {
    return 'unsupported';
  }
  try {
    const result = await window.Notification.requestPermission();
    return result;
  } catch {
    return 'denied';
  }
}

/**
 * Переход по ссылке уведомления: сначала фокус на вкладку (она могла быть свёрнута),
 * затем переход на deepLink. Без ссылки — в центр уведомлений.
 */
export function openNotificationTarget(deepLink: string | null): void {
  try {
    window.focus();
  } catch {
    // Фокус может быть запрещён политикой браузера — переход всё равно выполняем.
  }
  const target = deepLink && deepLink.trim() !== '' ? deepLink : '/notifications';
  window.location.assign(target);
}

/**
 * Показать системное уведомление. Возвращает созданный объект или null, если браузер не умеет
 * или разрешения нет: вызывающий код не обязан проверять это сам.
 */
export function showDesktopNotification(
  input: DesktopNotificationInput,
): Notification | null {
  if (!desktopNotificationsSupported() || notificationPermission() !== 'granted') {
    return null;
  }

  const notification = new window.Notification(input.title, {
    // Один тег на приложение: новое событие заменяет окно, а не добавляет второе.
    tag: NOTIFICATION_TAG,
    body: input.body ?? undefined,
    icon: '/logo-mark.svg',
    // Окно висит до действия пользователя (решение владельца 01.11.2026): он мог отойти,
    // и самоисчезнувшее окно означало бы «уведомление было, но вы его не увидели».
    // Safari и часть мобильных браузеров параметр игнорируют — там окно скроется само,
    // это ограничение платформы, а не дефект.
    requireInteraction: true,
  });

  notification.onclick = () => {
    input.onOpen?.();
    openNotificationTarget(input.deepLink);
    notification.close();
  };

  // Закрытие крестиком ничего не открывает: пользователь сказал «убрать окно», а не
  // «перейти в приложение». Обработчик оставлен пустым осознанно — так проверяется тестом.
  notification.onclose = () => undefined;

  return notification;
}
