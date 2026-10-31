import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NOTIFICATION_SETTINGS_KEY,
  readNotificationSettings,
  writeNotificationSettings,
} from '../settings';

/**
 * Настройки уведомлений (уровень 1, 01.11.2026).
 *
 * Экрана профиля нет, сервер не участвует: предпочтение устройства живёт в localStorage.
 * По умолчанию выключено всё — ничего не происходит без ведома пользователя.
 */
describe('настройки уведомлений', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('по умолчанию выключены и уведомления, и звук', () => {
    expect(readNotificationSettings()).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
    expect(DEFAULT_NOTIFICATION_SETTINGS).toEqual({ desktop: false, sound: false });
  });

  it('сохраняются и читаются обратно', () => {
    writeNotificationSettings({ desktop: true, sound: true });
    expect(readNotificationSettings()).toEqual({ desktop: true, sound: true });

    writeNotificationSettings({ desktop: true, sound: false });
    expect(readNotificationSettings()).toEqual({ desktop: true, sound: false });
  });

  it('битое хранилище не ломает приложение', () => {
    window.localStorage.setItem(NOTIFICATION_SETTINGS_KEY, 'не json');
    expect(readNotificationSettings()).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
  });

  it('неизвестные значения приводятся к выключенному состоянию', () => {
    window.localStorage.setItem(
      NOTIFICATION_SETTINGS_KEY,
      JSON.stringify({ desktop: 'да', sound: 1 }),
    );
    expect(readNotificationSettings()).toEqual({ desktop: false, sound: false });
  });
});
