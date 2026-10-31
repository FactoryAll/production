/**
 * Системное уведомление на рабочем столе и переход по ссылке (уровень 1, 01.11.2026).
 *
 * Вынесено отдельным модулем, чтобы клик по уведомлению проверялся тестом: в jsdom навигация
 * не реализована, и без отделяемого вызова её нечем проверить.
 */

export interface DesktopNotificationInput {
  id: string;
  title: string;
  body: string | null;
  deepLink: string | null;
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
    // tag склеивает одинаковые уведомления: одно событие — одно окно, без пачки.
    tag: input.id,
    body: input.body ?? undefined,
    icon: '/logo-mark.svg',
  });

  notification.onclick = () => {
    openNotificationTarget(input.deepLink);
    notification.close();
  };

  return notification;
}
