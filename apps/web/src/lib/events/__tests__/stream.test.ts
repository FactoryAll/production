import { describe, it, expect } from 'vitest';
import {
  isNotificationStreamChanged,
  notificationStreamFrame,
} from '../stream';

describe('SSE-канал уведомлений M09', () => {
  it('формирует кадр формата data: <json>', () => {
    expect(notificationStreamFrame({ unreadCount: 2, latestId: 'n-5' })).toBe(
      'data: {"unreadCount":2,"latestId":"n-5"}\n\n',
    );
  });

  it('сообщает об изменении при росте счётчика непрочитанных', () => {
    expect(
      isNotificationStreamChanged(
        { unreadCount: 1, latestId: 'n-1' },
        { unreadCount: 2, latestId: 'n-1' },
      ),
    ).toBe(true);
  });

  it('сообщает об изменении при появлении нового уведомления', () => {
    expect(
      isNotificationStreamChanged(
        { unreadCount: 1, latestId: 'n-1' },
        { unreadCount: 1, latestId: 'n-2' },
      ),
    ).toBe(true);
  });

  it('не шлёт кадр, если состояние не изменилось', () => {
    expect(
      isNotificationStreamChanged(
        { unreadCount: 0, latestId: null },
        { unreadCount: 0, latestId: null },
      ),
    ).toBe(false);
  });
});
