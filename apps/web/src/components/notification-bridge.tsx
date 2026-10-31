'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  desktopNotificationsSupported,
  notificationPermission,
  requestNotificationPermission,
  showDesktopNotification,
} from '@/lib/notifications/desktop';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  readNotificationSettings,
  writeNotificationSettings,
  type NotificationSettings,
} from '@/lib/notifications/settings';
import { prepareSound, playNotificationSound, soundSupported } from '@/lib/notifications/sound';
import { subscribeToNotificationStream } from '@/lib/notifications/stream-client';

/**
 * Мост уведомлений: одно соединение на всё приложение и системные уведомления поверх окон
 * (уровень 1, решение владельца 01.11.2026).
 *
 * Правила, которые здесь зафиксированы:
 *   1. **Подписка одна.** Мост, счётчик в шапке и страница `/notifications` берут кадры из
 *      `lib/notifications/stream-client`, у которого единственный `EventSource`.
 *   2. **Не спамим.** Уведомление показывается только когда `latestId` стал другим И это не
 *      первый кадр после подключения. Один id — одно уведомление (плюс `tag` его склеивает).
 *   3. **Скрытая вкладка показывается.** Это и есть назначение: человек работает в другом
 *      приложении, трекер открыт и неактивен — окно должно появиться над другими. Пачки при
 *      возврате при этом не будет: кадры обрабатываются по мере прихода (а не откладываются),
 *      повторный id молчит, а первый кадр задаёт базовую точку.
 *   4. **Разрешение — только по действию.** Кнопка в шапке, ничего на загрузке.
 *   5. **Тихая деградация.** Нет `EventSource`, нет `Notification`, нет Web Audio — приложение
 *      работает как раньше, мост просто ничего не делает.
 */
export function NotificationBridge() {
  const [settings, setSettings] = useState<NotificationSettings>(DEFAULT_NOTIFICATION_SETTINGS);
  const [permission, setPermission] = useState<
    'default' | 'granted' | 'denied' | 'unsupported'
  >('unsupported');
  const [panelOpen, setPanelOpen] = useState(false);
  // Последний известный id: null — канал ещё не давал кадров (первый кадр всегда молчит).
  const lastSeenId = useRef<string | null>(null);
  // Сколько событий пришло, пока окно висело неоткрытым. Окно одно (общий тег), поэтому
  // счётчик — единственный способ сказать «было ещё N». Сбрасывается, когда пользователь
  // открыл уведомление или вернулся во вкладку.
  const pendingCount = useRef(0);
  const settingsRef = useRef(settings);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    setSettings(readNotificationSettings());
    setPermission(notificationPermission());
  }, []);

  // Возврат во вкладку — пользователь вернулся в трекер: счётчик заменённых окон больше не нужен.
  useEffect(() => {
    const handleVisibility = () => {
      if (!document.hidden) {
        pendingCount.current = 0;
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToNotificationStream((frame) => {
      const previousId = lastSeenId.current;
      lastSeenId.current = frame.latestId;

      // Первый кадр после подключения — это «что уже есть», а не новое событие.
      if (previousId === null) {
        return;
      }
      // Тот же id — повторный кадр канала: тишина.
      if (frame.latestId === null || frame.latestId === previousId) {
        return;
      }
      const latest = frame.latest ?? null;
      if (settingsRef.current.sound) {
        playNotificationSound();
      }
      if (settingsRef.current.desktop && latest !== null) {
        pendingCount.current += 1;
        const more = pendingCount.current - 1;
        showDesktopNotification({
          id: latest.id,
          title: latest.title,
          // Окно одно: без счётчика заменённое событие исчезло бы бесследно.
          body: more > 0 ? `${latest.body ?? ''} (и ещё ${more})`.trim() : latest.body,
          deepLink: latest.deepLink,
          onOpen: () => {
            pendingCount.current = 0;
          },
        });
      }
    });

    return unsubscribe;
  }, []);

  const updateSettings = useCallback((next: NotificationSettings) => {
    setSettings(next);
    settingsRef.current = next;
    writeNotificationSettings(next);
  }, []);

  // Включение уведомлений — единственное место, где спрашиваем разрешение: по кнопке.
  const handleEnableDesktop = useCallback(async () => {
    if (!desktopNotificationsSupported()) {
      setPermission('unsupported');
      return;
    }
    const result = await requestNotificationPermission();
    setPermission(result);
    if (result === 'granted') {
      updateSettings({ ...settingsRef.current, desktop: true });
    }
  }, [updateSettings]);

  const handleToggleSound = useCallback(
    (next: boolean) => {
      // Звук «будим» в обработчике клика: до действия пользователя браузер его блокирует.
      if (next && soundSupported()) {
        prepareSound();
      }
      updateSettings({ ...settingsRef.current, sound: next });
    },
    [updateSettings],
  );

  if (permission === 'unsupported') {
    return null;
  }

  return (
    <div className="relative flex items-center gap-2">
      {permission === 'default' && (
        <button
          type="button"
          onClick={() => void handleEnableDesktop()}
          className="rounded-sm px-1.5 py-2 text-sm font-medium text-neutral-200 transition-colors hover:bg-white/10 hover:text-white"
          title="Включить уведомления на рабочем столе"
        >
          Включить уведомления
        </button>
      )}

      {permission === 'denied' && (
        <span
          className="text-xs text-neutral-300"
          title="Уведомления заблокированы в настройках браузера для этого сайта"
        >
          Уведомления запрещены в браузере
        </span>
      )}

      {permission === 'granted' && (
        <>
          <button
            type="button"
            aria-expanded={panelOpen}
            onClick={() => setPanelOpen((open) => !open)}
            className="rounded-sm px-1.5 py-2 text-sm font-medium text-neutral-200 transition-colors hover:bg-white/10 hover:text-white"
          >
            Уведомления
          </button>

          {panelOpen && (
            <div className="absolute right-0 top-full z-30 mt-1 w-64 space-y-2 rounded-md border border-mist-metal bg-white p-3 text-sm text-graphite shadow-lg">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.desktop}
                  onChange={(event) =>
                    updateSettings({ ...settings, desktop: event.target.checked })
                  }
                />
                Уведомления на рабочем столе
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.sound}
                  onChange={(event) => handleToggleSound(event.target.checked)}
                />
                Звук
              </label>
            </div>
          )}
        </>
      )}
    </div>
  );
}
