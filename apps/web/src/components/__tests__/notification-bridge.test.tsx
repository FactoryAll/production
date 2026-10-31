import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

/**
 * Мост уведомлений (уровень 1, 01.11.2026).
 *
 * Требования владельца, которые здесь закреплены: без разрешения не показываем; при новом id —
 * ровно одно уведомление; повторный кадр с тем же id — тишина; звук только при включённом
 * переключателе; первый кадр после подключения молчит; скрытая вкладка не спамит; клик ведёт
 * по deepLink.
 */

const showDesktopNotification = vi.fn();
const prepareSound = vi.fn();
const playNotificationSound = vi.fn();
const soundSupported = vi.fn(() => true);

vi.mock('@/lib/notifications/desktop', () => ({
  desktopNotificationsSupported: () => true,
  notificationPermission: () => permissionState,
  requestNotificationPermission: async () => 'granted',
  showDesktopNotification: (...args: unknown[]) => showDesktopNotification(...args),
  openNotificationTarget: vi.fn(),
}));

vi.mock('@/lib/notifications/sound', () => ({
  soundSupported: () => soundSupported(),
  prepareSound: (...args: unknown[]) => prepareSound(...args),
  playNotificationSound: (...args: unknown[]) => playNotificationSound(...args),
  resetSoundForTests: () => undefined,
}));

import { NotificationBridge } from '../notification-bridge';
import {
  resetNotificationStreamForTests,
  subscribeToNotificationStream,
} from '@/lib/notifications/stream-client';
import { NOTIFICATION_SETTINGS_KEY } from '@/lib/notifications/settings';

let permissionState: 'default' | 'granted' | 'denied' | 'unsupported' = 'granted';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

function emitFrame(payload: {
  unreadCount: number;
  latestId: string | null;
  latest?: { id: string; title: string; body: string | null; deepLink: string | null } | null;
}) {
  const source = FakeEventSource.instances.at(-1);
  if (!source) {
    throw new Error('Канал не открыт');
  }
  act(() => {
    source.emit(payload);
  });
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
}

beforeEach(() => {
  vi.clearAllMocks();
  FakeEventSource.instances = [];
  permissionState = 'granted';
  resetNotificationStreamForTests();
  window.localStorage.clear();
  setHidden(false);
  (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
});

afterEach(() => {
  resetNotificationStreamForTests();
  setHidden(false);
});

function frame(id: string) {
  return {
    unreadCount: 1,
    latestId: id,
    latest: { id, title: 'Новая задача 1С', body: 'ПЗ 1234', deepLink: '/onec/task-1' },
  };
}

describe('мост: когда показывать', () => {
  it('первый кадр молчит — это не новое событие, а текущее состояние', () => {
    render(<NotificationBridge />);

    emitFrame(frame('n-1'));

    expect(showDesktopNotification).not.toHaveBeenCalled();
    expect(playNotificationSound).not.toHaveBeenCalled();
  });

  it('новый id при включённых уведомлениях — ровно одно системное уведомление', () => {
    window.localStorage.setItem(
      NOTIFICATION_SETTINGS_KEY,
      JSON.stringify({ desktop: true, sound: false }),
    );
    render(<NotificationBridge />);

    emitFrame(frame('n-1'));
    emitFrame(frame('n-2'));

    expect(showDesktopNotification).toHaveBeenCalledTimes(1);
    expect(showDesktopNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'n-2',
        title: 'Новая задача 1С',
        body: 'ПЗ 1234',
        deepLink: '/onec/task-1',
      }),
    );
  });

  it('повторный кадр с тем же id — тишина', () => {
    window.localStorage.setItem(
      NOTIFICATION_SETTINGS_KEY,
      JSON.stringify({ desktop: true, sound: false }),
    );
    render(<NotificationBridge />);

    emitFrame(frame('n-1'));
    emitFrame(frame('n-2'));
    emitFrame(frame('n-2'));
    emitFrame(frame('n-2'));

    expect(showDesktopNotification).toHaveBeenCalledTimes(1);
  });

  // Гейт разрешения живёт в lib/notifications/desktop.ts — там он и проверяется
  // (файл __tests__/desktop.test.ts). Здесь проверяем, что мост не работает выключенным.
  it('при выключенном переключателе системного уведомления нет', () => {
    permissionState = 'granted';
    window.localStorage.setItem(
      NOTIFICATION_SETTINGS_KEY,
      JSON.stringify({ desktop: false, sound: false }),
    );
    render(<NotificationBridge />);

    emitFrame(frame('n-1'));
    emitFrame(frame('n-2'));

    expect(showDesktopNotification).not.toHaveBeenCalled();
  });

  it('браузер без поддержки уведомлений — мост ничего не рисует', () => {
    permissionState = 'unsupported';
    render(<NotificationBridge />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('разрешение запрашивается кнопкой, а не на загрузке', async () => {
    permissionState = 'default';
    render(<NotificationBridge />);

    const button = screen.getByRole('button', { name: 'Включить уведомления' });
    expect(button).toBeTruthy();
    // На загрузке ничего не спрашивали: до клика уведомлений нет.
    emitFrame(frame('n-1'));
    emitFrame(frame('n-2'));
    expect(showDesktopNotification).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(button);
    });
    // После разрешения кнопка исчезает, настройка включена.
    expect(screen.queryByRole('button', { name: 'Включить уведомления' })).toBeNull();
  });

  // Назначение уровня 1 — предупредить, когда трекер не на экране: в скрытой вкладке
  // уведомление ПОКАЗЫВАЕТСЯ. А пачки при возврате нет по другой причине: кадры обрабатываются
  // по мере прихода и не откладываются, а повтор id молчит.
  it('скрытая вкладка показывает уведомление — это и есть назначение', () => {
    window.localStorage.setItem(
      NOTIFICATION_SETTINGS_KEY,
      JSON.stringify({ desktop: true, sound: false }),
    );
    render(<NotificationBridge />);

    emitFrame(frame('n-1'));
    setHidden(true);
    emitFrame(frame('n-2'));

    expect(showDesktopNotification).toHaveBeenCalledTimes(1);
    expect(showDesktopNotification).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'n-2' }),
    );
  });

  it('при возврате на вкладку пачки нет: показанное не повторяется', () => {
    window.localStorage.setItem(
      NOTIFICATION_SETTINGS_KEY,
      JSON.stringify({ desktop: true, sound: false }),
    );
    render(<NotificationBridge />);

    emitFrame(frame('n-1'));
    setHidden(true);
    emitFrame(frame('n-2'));
    emitFrame(frame('n-3'));
    setHidden(false);
    // Возврат сам по себе кадров не порождает; повтор последнего кадра — тишина.
    emitFrame(frame('n-3'));

    expect(showDesktopNotification).toHaveBeenCalledTimes(2);
  });
});

describe('мост: одно окно и счётчик заменённых', () => {
  it('второе событие поверх висящего окна дописывает «и ещё 1»', () => {
    window.localStorage.setItem(
      NOTIFICATION_SETTINGS_KEY,
      JSON.stringify({ desktop: true, sound: false }),
    );
    render(<NotificationBridge />);

    emitFrame(frame('n-1'));
    emitFrame(frame('n-2'));
    emitFrame(frame('n-3'));

    const bodies = showDesktopNotification.mock.calls.map(
      (call) => (call[0] as { body: string | null }).body,
    );
    expect(bodies).toEqual(['ПЗ 1234', 'ПЗ 1234 (и ещё 1)']);
  });

  it('счётчик сбрасывается, когда пользователь открыл уведомление', () => {
    window.localStorage.setItem(
      NOTIFICATION_SETTINGS_KEY,
      JSON.stringify({ desktop: true, sound: false }),
    );
    render(<NotificationBridge />);

    emitFrame(frame('n-1'));
    emitFrame(frame('n-2'));
    // Пользователь кликнул по окну — вызываем переданный обработчик, как это делает модуль.
    const firstCall = showDesktopNotification.mock.calls[0][0] as { onOpen?: () => void };
    act(() => {
      firstCall.onOpen?.();
    });
    emitFrame(frame('n-3'));

    const lastBody = (
      showDesktopNotification.mock.calls.at(-1)?.[0] as { body: string | null }
    ).body;
    expect(lastBody).toBe('ПЗ 1234');
  });

  it('возврат во вкладку сбрасывает счётчик заменённых', () => {
    window.localStorage.setItem(
      NOTIFICATION_SETTINGS_KEY,
      JSON.stringify({ desktop: true, sound: false }),
    );
    render(<NotificationBridge />);

    emitFrame(frame('n-1'));
    emitFrame(frame('n-2'));
    setHidden(true);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    setHidden(false);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    emitFrame(frame('n-3'));

    const lastBody = (
      showDesktopNotification.mock.calls.at(-1)?.[0] as { body: string | null }
    ).body;
    expect(lastBody).toBe('ПЗ 1234');
  });
});

describe('мост: звук', () => {
  it('звук молчит, если переключатель выключен', () => {
    window.localStorage.setItem(
      NOTIFICATION_SETTINGS_KEY,
      JSON.stringify({ desktop: false, sound: false }),
    );
    render(<NotificationBridge />);

    emitFrame(frame('n-1'));
    emitFrame(frame('n-2'));

    expect(playNotificationSound).not.toHaveBeenCalled();
  });

  it('звук играет при включённом переключателе (разрешение не нужно)', () => {
    permissionState = 'default';
    window.localStorage.setItem(
      NOTIFICATION_SETTINGS_KEY,
      JSON.stringify({ desktop: false, sound: true }),
    );
    render(<NotificationBridge />);

    emitFrame(frame('n-1'));
    emitFrame(frame('n-2'));

    expect(playNotificationSound).toHaveBeenCalledTimes(1);
    expect(showDesktopNotification).not.toHaveBeenCalled();
  });

  it('переключатель звука «будит» Web Audio по действию пользователя', async () => {
    render(<NotificationBridge />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Уведомления' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Звук'));
    });

    expect(prepareSound).toHaveBeenCalled();
  });
});

describe('канал: одно соединение на приложение', () => {
  it('два подписчика — один EventSource', () => {
    const offA = subscribeToNotificationStream(() => undefined);
    const offB = subscribeToNotificationStream(() => undefined);

    expect(FakeEventSource.instances).toHaveLength(1);

    offA();
    offB();
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });

  it('повторная подписка после отписки открывает новое соединение', () => {
    const off = subscribeToNotificationStream(() => undefined);
    off();
    subscribeToNotificationStream(() => undefined);

    expect(FakeEventSource.instances).toHaveLength(2);
  });
});
