import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  notificationPermission,
  openNotificationTarget,
  showDesktopNotification,
} from '../desktop';

/**
 * Системное уведомление на рабочем столе (уровень 1, 01.11.2026).
 *
 * Здесь проверяется гейт разрешения и клик: браузер создаёт окно только при `granted`,
 * `tag` склеивает одинаковые уведомления, клик ведёт по deepLink.
 */

interface FakeNotification {
  title: string;
  options: NotificationOptions;
  onclick: (() => void) | null;
  close: () => void;
}

let created: FakeNotification[] = [];
let permission: 'default' | 'granted' | 'denied' = 'granted';
const assign = vi.fn();
const focus = vi.fn();

class FakeNotificationCtor {
  static permission = 'default';

  title: string;
  options: NotificationOptions;
  onclick: (() => void) | null = null;
  close = vi.fn();

  constructor(title: string, options: NotificationOptions = {}) {
    this.title = title;
    this.options = options;
    created.push(this as unknown as FakeNotification);
  }

  static requestPermission = vi.fn(async () => permission);
}

beforeEach(() => {
  created = [];
  permission = 'granted';
  assign.mockReset();
  focus.mockReset();

  class Ctor extends FakeNotificationCtor {
    static permission = 'granted';
  }
  Object.defineProperty(Ctor, 'permission', {
    configurable: true,
    get: () => permission,
  });
  (globalThis as unknown as { Notification: unknown }).Notification = Ctor;
  (window as unknown as { Notification: unknown }).Notification = Ctor;

  Object.defineProperty(window, 'focus', { configurable: true, value: focus });
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { assign },
  });
});

afterEach(() => {
  (globalThis as unknown as { Notification?: unknown }).Notification = undefined;
});

describe('разрешение', () => {
  it('без поддержки — unsupported', () => {
    (window as unknown as { Notification?: unknown }).Notification = undefined;
    expect(notificationPermission()).toBe('unsupported');
  });

  it('читается из браузера', () => {
    permission = 'default';
    expect(notificationPermission()).toBe('default');
    permission = 'denied';
    expect(notificationPermission()).toBe('denied');
  });
});

describe('показ уведомления', () => {
  it('без разрешения окно не создаётся и возвращается null', () => {
    permission = 'default';
    expect(
      showDesktopNotification({ id: 'n-1', title: 'T', body: 'B', deepLink: '/onec/1' }),
    ).toBeNull();
    expect(created).toHaveLength(0);

    permission = 'denied';
    expect(
      showDesktopNotification({ id: 'n-1', title: 'T', body: 'B', deepLink: '/onec/1' }),
    ).toBeNull();
    expect(created).toHaveLength(0);
  });

  it('при разрешении создаётся окно с title, body, tag и icon', () => {
    const result = showDesktopNotification({
      id: 'n-42',
      title: 'Новая задача 1С',
      body: 'ПЗ 1234',
      deepLink: '/onec/task-1',
    });

    expect(result).not.toBeNull();
    expect(created).toHaveLength(1);
    expect(created[0].title).toBe('Новая задача 1С');
    expect(created[0].options).toMatchObject({
      body: 'ПЗ 1234',
      // tag = id: одно событие — одно окно, без пачки.
      tag: 'n-42',
      icon: '/logo-mark.svg',
    });
  });

  it('без body окно всё равно создаётся', () => {
    showDesktopNotification({ id: 'n-1', title: 'T', body: null, deepLink: null });
    expect(created[0].options.body).toBeUndefined();
  });
});

describe('клик по уведомлению', () => {
  it('фокусирует вкладку и ведёт по deepLink', () => {
    const notification = showDesktopNotification({
      id: 'n-7',
      title: 'T',
      body: null,
      deepLink: '/production-orders/po-1',
    });

    notification?.onclick?.call(notification, new Event('click') as never);

    expect(focus).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/production-orders/po-1');
  });

  it('без deepLink ведёт в центр уведомлений', () => {
    const notification = showDesktopNotification({
      id: 'n-8',
      title: 'T',
      body: null,
      deepLink: null,
    });

    notification?.onclick?.call(notification, new Event('click') as never);

    expect(assign).toHaveBeenCalledWith('/notifications');
  });

  it('переход по ссылке выносит фокус и навигацию отдельной функцией', () => {
    openNotificationTarget(null);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/notifications');
  });
});
