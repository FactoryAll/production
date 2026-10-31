/**
 * Настройки уведомлений на рабочем столе (уровень 1, 01.11.2026).
 *
 * Экрана профиля нет, поэтому настройки живут в браузере (`localStorage`), а сервер о них
 * не знает — это личное предпочтение устройства, а не данные учётной записи.
 *
 * Значения по умолчанию: уведомления выключены (до разрешения браузера), звук выключен —
 * чтобы ничего не происходило без ведома пользователя.
 */

export interface NotificationSettings {
  /** Показывать системные уведомления на рабочем столе. */
  desktop: boolean;
  /** Играть короткий сигнал при новом уведомлении. */
  sound: boolean;
}

export const NOTIFICATION_SETTINGS_KEY = 'prodtrack.notifications';

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  desktop: false,
  sound: false,
};

/** Чтение настроек: битое или недоступное хранилище не должно ломать приложение. */
export function readNotificationSettings(): NotificationSettings {
  if (typeof window === 'undefined') {
    return DEFAULT_NOTIFICATION_SETTINGS;
  }
  try {
    const raw = window.localStorage.getItem(NOTIFICATION_SETTINGS_KEY);
    if (!raw) {
      return DEFAULT_NOTIFICATION_SETTINGS;
    }
    const parsed = JSON.parse(raw) as Partial<NotificationSettings>;
    return {
      desktop: parsed.desktop === true,
      sound: parsed.sound === true,
    };
  } catch {
    return DEFAULT_NOTIFICATION_SETTINGS;
  }
}

/** Запись настроек: ошибку хранилища (приватный режим) глотаем молча. */
export function writeNotificationSettings(settings: NotificationSettings): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(NOTIFICATION_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Хранилище недоступно — работаем с настройками в памяти.
  }
}
