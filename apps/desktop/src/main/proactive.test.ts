// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

vi.mock('./logging', () => ({
  getLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}));

const storeData: Record<string, unknown> = {};
vi.mock('./store', () => ({
  getStore: () => ({
    get: (key: string) => storeData[key],
    set: (key: string, value: unknown) => {
      storeData[key] = value;
    },
  }),
}));

import {
  fireEvent,
  getStatus,
  listTriggers,
  onNotification,
  registerTrigger,
  removeTrigger,
  sendNotification,
} from './proactive';

describe('registerTrigger', () => {
  it('adds a new trigger', () => {
    const result = registerTrigger({
      id: 'test-trigger',
      event: 'session.idle',
      action: 'notify-user',
    });
    expect(result.ok).toBe(true);
    expect(listTriggers()).toContainEqual({
      id: 'test-trigger',
      event: 'session.idle',
      action: 'notify-user',
    });
  });

  it('updates an existing trigger with the same id', () => {
    registerTrigger({ id: 'update-test', event: 'a', action: 'b' });
    registerTrigger({ id: 'update-test', event: 'c', action: 'd' });
    const triggers = listTriggers().filter((t) => t.id === 'update-test');
    expect(triggers).toHaveLength(1);
    expect(triggers[0].event).toBe('c');
  });
});

describe('removeTrigger', () => {
  it('removes a trigger by id', () => {
    registerTrigger({ id: 'remove-me', event: 'x', action: 'y' });
    expect(listTriggers().some((t) => t.id === 'remove-me')).toBe(true);
    removeTrigger('remove-me');
    expect(listTriggers().some((t) => t.id === 'remove-me')).toBe(false);
  });
});

describe('fireEvent', () => {
  it('executes matching triggers', () => {
    registerTrigger({
      id: 'fire-test',
      event: 'test.event',
      action: 'notify-user',
      config: { type: 'info', title: 'Test', message: 'Hello' },
    });

    const notifications: unknown[] = [];
    const unsub = onNotification((n) => notifications.push(n));

    const result = fireEvent('test.event', {});
    expect(result.actionsExecuted).toBe(1);
    expect(notifications).toHaveLength(1);

    unsub();
  });

  it('returns 0 when no triggers match', () => {
    const result = fireEvent('nonexistent.event', {});
    expect(result.actionsExecuted).toBe(0);
  });
});

describe('sendNotification', () => {
  it('notifies all listeners', () => {
    const received: unknown[] = [];
    const unsub1 = onNotification((n) => received.push(n));
    const unsub2 = onNotification((n) => received.push(n));

    sendNotification({
      id: 'test-notif',
      type: 'success',
      title: 'Test',
      message: 'Message',
      timestamp: '2026-10-04T00:00:00Z',
    });

    expect(received).toHaveLength(2);
    unsub1();
    unsub2();
  });

  it('increments notificationsSent counter', () => {
    const before = getStatus().notificationsSent;
    sendNotification({
      id: 'counter-test',
      type: 'info',
      title: 'Test',
      message: 'Message',
      timestamp: '2026-10-04T00:00:00Z',
    });
    expect(getStatus().notificationsSent).toBe(before + 1);
  });
});

describe('getStatus', () => {
  it('returns current state', () => {
    const status = getStatus();
    expect(typeof status.enabled).toBe('boolean');
    expect(typeof status.triggers).toBe('number');
    expect(typeof status.notificationsSent).toBe('number');
  });
});
